//! A live audio meter, exported to TSX as `AudioMeter`: how loud the music
//! is, its bass, mids and treble, a 16-band spectrum and a beat pulse, about
//! 60 times a second, for visuals that move with the music
//! (`src/platform/audio.ts`).
//!
//! The music plays inside the headless Chromium the engine runs. Widevine
//! keeps Web Audio from tapping it inside the page, but the sound reaches the
//! system mixer like any app's, so the meter records it there:
//!
//! - Linux: `parec` (PulseAudio, or PipeWire's pulse server) records the
//!   sink input of Spotish's own Chromium (`--monitor-stream`), found by its
//!   `application.process.id` being a descendant of this process; without
//!   one it records the default sink's monitor (everything that plays). The
//!   stream is looked for again every few seconds, so the meter follows the
//!   browser being restarted.
//! - macOS 14.2+: a Core Audio process tap on the processes of Spotish's own
//!   Chromium that play (its audio service), private and unmuted, read
//!   through a private aggregate device and resampled to 48 kHz. The first
//!   tap asks for "System Audio Recording" (`NSAudioCaptureUsageDescription`
//!   in nsh.json). Older macOS: unavailable.
//! - Windows and elsewhere: unavailable (`available` is false, no frames).
//!   TODO: WASAPI process loopback
//!   (`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`, Windows 10 2004+).
//!
//! The analysis runs on a thread of its own (see [`analysis`]); frames reach
//! JS through a channel pumped by `run()`, as `MediaControls` and
//! `SystemTheme` deliver theirs. After a second of silence one zero frame is
//! sent and delivery pauses until sound returns.

use std::{cell::RefCell, rc::Rc};

use nsh_core::prelude::*;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};

/// One moment of the music, every value from 0 to 1. Quiet and loud tracks
/// move alike: each value is measured against what was loud a few seconds
/// before.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct AudioFrame {
    /// Loudness (smoothed RMS).
    pub level: f64,
    /// Bass, 20–250 Hz.
    pub bass: f64,
    /// Mids, 250 Hz–4 kHz.
    pub mid: f64,
    /// Treble, 4–16 kHz.
    pub treble: f64,
    /// A pulse: 1 on a beat (an onset in the bass), falling to 0 over about
    /// 200 ms.
    pub beat: f64,
    /// The spectrum: 16 bands, log-spaced from 40 Hz to 16 kHz, lowest
    /// first.
    pub bands: Vec<f64>,
}

impl AudioFrame {
    /// Silence: every value 0.
    pub fn zero() -> Self {
        AudioFrame { bands: vec![0.0; BANDS], ..AudioFrame::default() }
    }
}

/// The number of spectrum bands in a frame.
pub const BANDS: usize = 16;

#[derive(Default)]
struct Inner {
    next: u64,
    listeners: Vec<(u64, Callback<AudioFrame>)>,
    rx: Option<UnboundedReceiver<AudioFrame>>,
    tx: Option<UnboundedSender<AudioFrame>>,
    capture: Option<capture::Capture>,
}

/// A live meter of the music Spotish plays: loudness, bass, mids, treble, a
/// spectrum and a beat pulse, about 60 frames a second while sound plays.
/// Linux only for now; elsewhere `available` is false and no frames come.
#[class]
pub struct AudioMeter {
    inner: Rc<RefCell<Inner>>,
}

impl Default for AudioMeter {
    fn default() -> Self {
        Self::new()
    }
}

#[class]
impl AudioMeter {
    /// Makes a meter; it records nothing until `run()`.
    pub fn new() -> Self {
        let (tx, rx) = unbounded_channel();
        AudioMeter { inner: Rc::new(RefCell::new(Inner { rx: Some(rx), tx: Some(tx), ..Inner::default() })) }
    }

    /// Whether the system's audio can be recorded here (Linux with `parec`,
    /// macOS 14.2+).
    #[getter]
    pub fn available(&self) -> bool {
        capture::available()
    }

    /// Calls `listener` with each frame (at most about 60 a second; one
    /// zero frame after a second of silence, then none until sound
    /// returns). Call `run()` once to start.
    pub fn on_frame(&self, #[args(frame)] listener: Callback<AudioFrame>) -> Stop {
        let inner = self.inner.clone();
        let id = {
            let mut w = inner.borrow_mut();
            let id = w.next;
            w.next += 1;
            w.listeners.push((id, listener));
            id
        };
        Stop::new(move || inner.borrow_mut().listeners.retain(|(i, _)| *i != id))
    }

    /// Starts recording and delivers frames to the `onFrame` listeners;
    /// resolves when the meter stops (at once where it is unavailable).
    /// Call it once.
    pub async fn run(this: Instance<Self>) {
        let inner = this.with(|s| s.inner.clone());
        // Not kept: disposing the meter stops it (its drop ends the
        // capture, which ends this loop).
        drop(this);
        let (Some(mut rx), Some(tx)) = ({
            let mut w = inner.borrow_mut();
            (w.rx.take(), w.tx.take())
        }) else {
            return;
        };
        let Some(capture) = capture::Capture::start(tx) else { return };
        inner.borrow_mut().capture = Some(capture);
        while let Some(mut frame) = rx.recv().await {
            // Behind: only the newest frame matters.
            while let Ok(newer) = rx.try_recv() {
                frame = newer;
            }
            for (_, cb) in &inner.borrow().listeners {
                cb.post(frame.clone());
            }
        }
    }

    /// Stops recording; `run()` resolves. Disposing the meter does the same.
    pub fn stop(&self) {
        let mut w = self.inner.borrow_mut();
        w.capture = None;
        // Before `run()`: nothing will ever be sent.
        w.tx = None;
    }
}

impl Drop for AudioMeter {
    fn drop(&mut self) {
        self.stop();
    }
}

/// The analysis: mono samples in, smoothed and auto-gained frames out.
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
pub mod analysis {
    use std::{collections::VecDeque, sync::Arc};

    use rustfft::{Fft, FftPlanner, num_complex::Complex};

    use super::{AudioFrame, BANDS};

    /// The rate the meter records at.
    pub const SAMPLE_RATE: f32 = 48_000.0;
    /// FFT window length (21 ms at 48 kHz).
    pub const FFT_SIZE: usize = 1024;
    /// Samples between two analyses: 120 a second, every other one sent
    /// (60 a second).
    pub const HOP: usize = 400;

    /// Below this window RMS (-80 dBFS) it is silence.
    const GATE: f32 = 1e-4;
    /// The dynamic range a value spans, in dB below its reference.
    const RANGE_DB: f32 = 36.0;
    const LEVEL_RANGE_DB: f32 = 30.0;
    /// How far below the loudest band a band's reference may fall: a band
    /// this much quieter than the rest is not raised to full scale.
    const SPREAD_DB: f32 = 12.0;
    /// The lowest a reference goes, so faint noise is not raised to full
    /// scale. The bands' is low: the tilt takes up to 14 dB off the bass.
    const FLOOR_DB: f32 = -80.0;
    /// The lowest loudness reference: a track at -60 dBFS RMS fills it.
    const LEVEL_FLOOR_DB: f32 = -60.0;
    /// How fast references fall (the auto-gain's release), dB per second.
    const DECAY_DB_PER_S: f32 = 4.0;
    /// Smoothing time constants, seconds.
    const ATTACK_S: f32 = 0.03;
    const RELEASE_S: f32 = 0.25;
    /// The beat pulse falls from 1 to 0 in this long.
    const BEAT_FALL_S: f32 = 0.2;
    /// No second onset sooner than this.
    const REFRACTORY_S: f32 = 0.12;
    /// The onset threshold: the flux's mean plus this many standard
    /// deviations over the last second, and at least `FLUX_MIN`.
    const FLUX_K: f32 = 1.5;
    const FLUX_MIN: f32 = 1.0;

    const BAND_LOW_HZ: f32 = 40.0;
    const BAND_HIGH_HZ: f32 = 16_000.0;
    /// Bass, mids, treble.
    const GROUPS: [(f32, f32); 3] = [(20.0, 250.0), (250.0, 4_000.0), (4_000.0, 16_000.0)];
    /// The bins the beat detector watches (about 45–190 Hz: kicks, bass).
    const BEAT_BINS: std::ops::Range<usize> = 1..5;

    /// A run of bins and its pink-noise tilt (music's energy falls with
    /// frequency; the tilt evens the bands out).
    #[derive(Clone, Copy)]
    struct Span {
        lo: usize,
        hi: usize,
        tilt: f32,
    }

    impl Span {
        fn new(lo_hz: f32, hi_hz: f32) -> Self {
            let bin = SAMPLE_RATE / FFT_SIZE as f32;
            let lo = ((lo_hz / bin).round() as usize).max(1);
            let hi = ((hi_hz / bin).round() as usize).clamp(lo + 1, FFT_SIZE / 2 + 1);
            let center = (lo_hz * hi_hz).sqrt();
            Span { lo, hi, tilt: (center / 1000.0).sqrt() }
        }

        /// The span's amplitude in dBFS (RMS of its bins, tilted).
        fn db(&self, mags: &[f32]) -> f32 {
            let bins = &mags[self.lo..self.hi];
            let power = bins.iter().map(|m| m * m).sum::<f32>() / bins.len() as f32;
            db(power.sqrt() * self.tilt)
        }
    }

    fn db(amplitude: f32) -> f32 {
        20.0 * amplitude.max(1e-12).log10()
    }

    /// A value measured against a slowly falling reference (the auto-gain).
    #[derive(Clone, Copy)]
    struct Gain {
        reference: f32,
    }

    impl Gain {
        const fn new() -> Self {
            Gain { reference: FLOOR_DB }
        }

        /// Lowers the reference by `decay` dB, raises it to `db`, and
        /// gives `db` on a 0..1 scale `range` dB below `max(reference,
        /// least)`.
        fn measure(&mut self, db: f32, decay: f32, least: f32, range: f32) -> f32 {
            self.reference = (self.reference - decay).max(db).max(FLOOR_DB);
            let top = self.reference.max(least);
            ((db - (top - range)) / range).clamp(0.0, 1.0)
        }
    }

    /// Fast attack, slow release.
    #[derive(Clone, Copy)]
    struct Smooth {
        attack: f32,
        release: f32,
    }

    impl Smooth {
        fn toward(&self, current: f32, target: f32) -> f32 {
            let k = if target > current { self.attack } else { self.release };
            current + (target - current) * k
        }
    }

    /// One analysis step's result.
    #[derive(Debug, Clone, Copy, PartialEq)]
    pub struct Levels {
        pub level: f32,
        pub bass: f32,
        pub mid: f32,
        pub treble: f32,
        pub beat: f32,
        pub bands: [f32; BANDS],
        /// The window held sound (above the gate).
        pub loud: bool,
        /// A beat started in this step.
        pub onset: bool,
    }

    impl Levels {
        pub fn frame(&self) -> AudioFrame {
            let r = |v: f32| (f64::from(v) * 1000.0).round() / 1000.0;
            AudioFrame {
                level: r(self.level),
                bass: r(self.bass),
                mid: r(self.mid),
                treble: r(self.treble),
                beat: r(self.beat),
                bands: self.bands.iter().map(|v| r(*v)).collect(),
            }
        }
    }

    /// The meter's analysis: feed it samples, hear a [`Levels`] every
    /// [`HOP`] samples.
    pub struct Analyzer {
        fft: Arc<dyn Fft<f32>>,
        window: Vec<f32>,
        /// Hann's sum, halved: a full-scale sine's bin reads 1.
        norm: f32,
        samples: Vec<f32>,
        buf: Vec<Complex<f32>>,
        scratch: Vec<Complex<f32>>,
        mags: Vec<f32>,
        bands: [Span; BANDS],
        groups: [Span; 3],
        band_gain: [Gain; BANDS],
        group_gain: [Gain; 3],
        level_gain: Gain,
        /// The loudest band's and group's reference (all bands' auto-gain).
        band_top: Gain,
        group_top: Gain,
        decay: f32,
        smooth: Smooth,
        out: Levels,
        prev_beat: Vec<f32>,
        flux: VecDeque<f32>,
        since_onset: usize,
    }

    impl Default for Analyzer {
        fn default() -> Self {
            Self::new()
        }
    }

    impl Analyzer {
        pub fn new() -> Self {
            let fft = FftPlanner::new().plan_fft_forward(FFT_SIZE);
            let window: Vec<f32> = (0..FFT_SIZE)
                .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / FFT_SIZE as f32).cos())
                .collect();
            let norm = window.iter().sum::<f32>() / 2.0;
            let ratio = (BAND_HIGH_HZ / BAND_LOW_HZ).powf(1.0 / BANDS as f32);
            let bands = std::array::from_fn(|i| {
                let lo = BAND_LOW_HZ * ratio.powi(i as i32);
                Span::new(lo, lo * ratio)
            });
            let groups = GROUPS.map(|(lo, hi)| Span::new(lo, hi));
            let hop_s = HOP as f32 / SAMPLE_RATE;
            let coefficient = |tau: f32| 1.0 - (-hop_s / tau).exp();
            let scratch = vec![Complex::default(); fft.get_inplace_scratch_len()];
            Analyzer {
                fft,
                window,
                norm,
                samples: Vec::with_capacity(FFT_SIZE + HOP * 8),
                buf: vec![Complex::default(); FFT_SIZE],
                scratch,
                mags: vec![0.0; FFT_SIZE / 2 + 1],
                bands,
                groups,
                band_gain: [Gain::new(); BANDS],
                group_gain: [Gain::new(); 3],
                level_gain: Gain::new(),
                band_top: Gain::new(),
                group_top: Gain::new(),
                decay: DECAY_DB_PER_S * hop_s,
                smooth: Smooth { attack: coefficient(ATTACK_S), release: coefficient(RELEASE_S) },
                out: Levels { level: 0.0, bass: 0.0, mid: 0.0, treble: 0.0, beat: 0.0, bands: [0.0; BANDS], loud: false, onset: false },
                prev_beat: vec![0.0; BEAT_BINS.len()],
                flux: VecDeque::with_capacity(Self::FLUX_HISTORY),
                since_onset: usize::MAX,
            }
        }

        /// One second of flux values.
        const FLUX_HISTORY: usize = (SAMPLE_RATE as usize) / HOP;

        /// Feeds interleaved samples of `channels` channels (mixed to
        /// mono); calls `step` after each hop.
        pub fn push(&mut self, interleaved: &[f32], channels: usize, mut step: impl FnMut(&Levels)) {
            let channels = channels.max(1);
            let scale = 1.0 / channels as f32;
            for chunk in interleaved.chunks_exact(channels) {
                let s: f32 = chunk.iter().sum::<f32>() * scale;
                self.samples.push(if s.is_finite() { s } else { 0.0 });
                if self.samples.len() == FFT_SIZE {
                    self.analyze();
                    step(&self.out);
                    self.samples.drain(..HOP);
                }
            }
        }

        fn analyze(&mut self) {
            let x = &self.samples[..FFT_SIZE];
            let rms = (x.iter().map(|s| s * s).sum::<f32>() / FFT_SIZE as f32).sqrt();
            let loud = rms >= GATE;

            for ((b, s), w) in self.buf.iter_mut().zip(x).zip(&self.window) {
                *b = Complex::new(s * w, 0.0);
            }
            self.fft.process_with_scratch(&mut self.buf, &mut self.scratch);
            for (m, b) in self.mags.iter_mut().zip(&self.buf) {
                *m = b.norm() / self.norm;
            }

            // Spectrum and groups, each against its own reference but never
            // more than SPREAD below the loudest one's.
            let decay = self.decay;
            let mut band_db = [0.0f32; BANDS];
            for (d, span) in band_db.iter_mut().zip(&self.bands) {
                *d = span.db(&self.mags);
            }
            let group_db = self.groups.map(|span| span.db(&self.mags));
            let loudest = |dbs: &[f32]| dbs.iter().copied().fold(f32::MIN, f32::max);
            self.band_top.measure(loudest(&band_db), decay, FLOOR_DB, RANGE_DB);
            self.group_top.measure(loudest(&group_db), decay, FLOOR_DB, RANGE_DB);
            let band_least = self.band_top.reference - SPREAD_DB;
            let group_least = self.group_top.reference - SPREAD_DB;
            let mut bands = [0.0f32; BANDS];
            for ((v, gain), d) in bands.iter_mut().zip(&mut self.band_gain).zip(band_db) {
                *v = gain.measure(d, decay, band_least, RANGE_DB);
            }
            let mut groups = [0.0f32; 3];
            for ((v, gain), d) in groups.iter_mut().zip(&mut self.group_gain).zip(group_db) {
                *v = gain.measure(d, decay, group_least, RANGE_DB);
            }
            let level = self.level_gain.measure(db(rms), decay, LEVEL_FLOOR_DB, LEVEL_RANGE_DB);

            // Spectral flux on the bass bins (log magnitudes, so it is the
            // rise in dB whatever the volume), against an adaptive
            // threshold.
            let mut flux = 0.0;
            for (prev, m) in self.prev_beat.iter_mut().zip(&self.mags[BEAT_BINS]) {
                let now = (1.0 + m * 1e4).ln();
                flux += (now - *prev).max(0.0);
                *prev = now;
            }
            let n = self.flux.len().max(1) as f32;
            let mean = self.flux.iter().sum::<f32>() / n;
            let var = self.flux.iter().map(|f| (f - mean) * (f - mean)).sum::<f32>() / n;
            let threshold = (mean + FLUX_K * var.sqrt()).max(FLUX_MIN);
            if self.flux.len() == Self::FLUX_HISTORY {
                self.flux.pop_front();
            }
            self.flux.push_back(flux);
            let hop_s = HOP as f32 / SAMPLE_RATE;
            let refractory = (REFRACTORY_S / hop_s).ceil() as usize;
            self.since_onset = self.since_onset.saturating_add(1);
            let onset = loud && flux > threshold && self.since_onset >= refractory;
            if onset {
                self.since_onset = 0;
            }

            let s = self.smooth;
            let o = &mut self.out;
            let gate = |v: f32| if loud { v } else { 0.0 };
            o.level = s.toward(o.level, gate(level));
            o.bass = s.toward(o.bass, gate(groups[0]));
            o.mid = s.toward(o.mid, gate(groups[1]));
            o.treble = s.toward(o.treble, gate(groups[2]));
            for (v, t) in o.bands.iter_mut().zip(bands) {
                *v = s.toward(*v, gate(t));
            }
            o.beat = if onset { 1.0 } else { (o.beat - hop_s / BEAT_FALL_S).max(0.0) };
            o.loud = loud;
            o.onset = onset;
        }
    }

    /// Picks which steps reach JS: every other one (60 a second), and,
    /// after a second without sound, one zero frame and then none until
    /// sound returns.
    pub struct Emitter {
        step: usize,
        quiet: usize,
        paused: bool,
    }

    impl Default for Emitter {
        fn default() -> Self {
            Self::new()
        }
    }

    impl Emitter {
        /// Steps of silence before pausing (1 s).
        const QUIET_STEPS: usize = (SAMPLE_RATE as usize) / HOP;

        pub fn new() -> Self {
            // Paused until the first sound: nothing to say before it.
            Emitter { step: 0, quiet: 0, paused: true }
        }

        /// What to send for this step, if anything.
        pub fn step(&mut self, levels: &Levels) -> Option<AudioFrame> {
            if levels.loud {
                self.quiet = 0;
                self.paused = false;
            } else {
                self.quiet += 1;
                if self.quiet >= Self::QUIET_STEPS {
                    return self.silence();
                }
            }
            if self.paused {
                return None;
            }
            self.step += 1;
            // An onset is always sent, so no beat is lost to the halving.
            (self.step.is_multiple_of(2) || levels.onset).then(|| levels.frame())
        }

        /// No samples arrive (a corked or suspended stream): the same as
        /// silence. One zero frame, if not yet sent.
        pub fn silence(&mut self) -> Option<AudioFrame> {
            if self.paused {
                return None;
            }
            self.paused = true;
            Some(AudioFrame::zero())
        }
    }
}

#[cfg(target_os = "linux")]
mod capture {
    //! Recording with `parec`, on a thread of its own.

    use std::{
        io::Read,
        path::PathBuf,
        process::{Child, Command, Stdio},
        sync::{
            Arc, Mutex,
            atomic::{AtomicBool, Ordering},
            mpsc,
        },
        time::{Duration, Instant},
    };

    use tokio::sync::mpsc::UnboundedSender;

    use super::{
        AudioFrame,
        analysis::{Analyzer, Emitter},
    };

    /// How often the stream is looked for again.
    const RESOLVE_EVERY: Duration = Duration::from_secs(3);
    /// No samples for this long counts as silence.
    const STALL: Duration = Duration::from_secs(1);
    const CHANNELS: usize = 2;

    fn find(program: &str) -> Option<PathBuf> {
        std::env::var_os("PATH")?
            .to_str()?
            .split(':')
            .map(|dir| PathBuf::from(dir).join(program))
            .find(|p| p.is_file())
    }

    pub fn available() -> bool {
        static PAREC: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        *PAREC.get_or_init(|| find("parec").is_some())
    }

    /// What `parec` records.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum Target {
        /// A sink input (Spotish's browser's stream).
        Stream(u32),
        /// The default sink's monitor: everything that plays.
        DefaultMonitor,
    }

    /// The running recorder; dropped, it stops (and kills `parec`).
    pub struct Capture {
        stop: Arc<AtomicBool>,
        child: Arc<Mutex<Option<Child>>>,
    }

    impl Capture {
        pub fn start(tx: UnboundedSender<AudioFrame>) -> Option<Self> {
            if !available() {
                return None;
            }
            let stop = Arc::new(AtomicBool::new(false));
            let child = Arc::new(Mutex::new(None));
            let (s, c) = (stop.clone(), child.clone());
            std::thread::Builder::new()
                .name("ytmfast-audio".into())
                .spawn(move || record(tx, s, c))
                .map_err(|e| log::warn!("audio meter: no thread: {e}"))
                .ok()?;
            Some(Capture { stop, child })
        }
    }

    impl Drop for Capture {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            kill(&self.child);
        }
    }

    fn kill(slot: &Mutex<Option<Child>>) {
        let child = slot.lock().ok().and_then(|mut c| c.take());
        if let Some(mut child) = child {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// The recording thread: (re)starts `parec` on the stream to record,
    /// analyzes what it reads, sends frames. `parec` is started here, so
    /// it gets SIGTERM if this thread ends some other way.
    fn record(tx: UnboundedSender<AudioFrame>, stop: Arc<AtomicBool>, slot: Arc<Mutex<Option<Child>>>) {
        let mut analyzer = Analyzer::new();
        let mut emitter = Emitter::new();
        let mut target: Option<Target> = None;
        let mut chunks: Option<mpsc::Receiver<Vec<f32>>> = None;
        let mut next_resolve = Instant::now();
        let mut last_data = Instant::now();
        let send = |frame: Option<AudioFrame>| frame.is_none_or(|f| tx.send(f).is_ok());

        while !stop.load(Ordering::SeqCst) {
            if Instant::now() >= next_resolve {
                next_resolve = Instant::now() + RESOLVE_EVERY;
                let wanted = resolve();
                if chunks.is_none() || target != Some(wanted) {
                    kill(&slot);
                    chunks = None;
                    target = None;
                    match spawn(wanted) {
                        Ok((child, rx)) => {
                            log::debug!("audio meter: recording {wanted:?}");
                            *slot.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
                            // Stopped while starting: the drop missed it.
                            if stop.load(Ordering::SeqCst) {
                                kill(&slot);
                                break;
                            }
                            chunks = Some(rx);
                            target = Some(wanted);
                            last_data = Instant::now();
                        }
                        Err(e) => log::warn!("audio meter: cannot start parec: {e}"),
                    }
                }
            }
            let Some(rx) = chunks.as_ref() else {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            };
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(samples) => {
                    last_data = Instant::now();
                    let mut open = true;
                    analyzer.push(&samples, CHANNELS, |levels| open &= send(emitter.step(levels)));
                    if !open {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if last_data.elapsed() >= STALL && !send(emitter.silence()) {
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    // parec ended (its stream went): look again soon.
                    log::debug!("audio meter: parec ended");
                    kill(&slot);
                    chunks = None;
                    target = None;
                    next_resolve = Instant::now() + Duration::from_secs(1);
                    if !send(emitter.silence()) {
                        break;
                    }
                }
            }
        }
        kill(&slot);
    }

    fn spawn(target: Target) -> std::io::Result<(Child, mpsc::Receiver<Vec<f32>>)> {
        let mut command = Command::new("parec");
        command.args([
            "--format=float32le",
            "--rate=48000",
            "--channels=2",
            "--latency-msec=20",
            "--raw",
            "--client-name=Spotish",
            "--stream-name=Audio meter",
        ]);
        match target {
            Target::Stream(index) => command.arg(format!("--monitor-stream={index}")),
            Target::DefaultMonitor => command.args(["-d", "@DEFAULT_MONITOR@"]),
        };
        command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
        die_with_parent(&mut command);
        let mut child = command.spawn()?;
        let Some(mut out) = child.stdout.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(std::io::Error::other("no stdout"));
        };
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new().name("ytmfast-audio-read".into()).spawn(move || {
            // 10 ms of stereo float32 per read.
            let mut bytes = vec![0u8; 480 * CHANNELS * 4];
            let mut have = 0;
            loop {
                match out.read(&mut bytes[have..]) {
                    Ok(0) | Err(_) => return,
                    Ok(n) => have += n,
                }
                let whole = have - have % 4;
                let samples: Vec<f32> =
                    bytes[..whole].as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect();
                bytes.copy_within(whole..have, 0);
                have -= whole;
                if tx.send(samples).is_err() {
                    return;
                }
            }
        })?;
        Ok((child, rx))
    }

    /// SIGTERM to `parec` when the thread that started it ends, however
    /// the app ends (as the browser gets, `spotify::chrome`).
    fn die_with_parent(command: &mut Command) {
        use std::os::unix::process::CommandExt;
        // SAFETY: getpid is always safe.
        let parent = unsafe { libc::getpid() };
        // SAFETY: prctl and getppid are async-signal-safe.
        unsafe {
            command.pre_exec(move || {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
                if libc::getppid() != parent {
                    libc::_exit(0);
                }
                Ok(())
            });
        }
    }

    /// The stream to record: Spotish's browser's sink input, else the
    /// default monitor.
    fn resolve() -> Target {
        let me = std::process::id();
        sink_inputs()
            .into_iter()
            .filter(|s| s.pid.is_some_and(|pid| descends_from(pid, me)))
            // Of several (an ad and the track, a restart), the playing one.
            .min_by_key(|s| s.corked)
            .map_or(Target::DefaultMonitor, |s| Target::Stream(s.index))
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct SinkInput {
        pub index: u32,
        pub pid: Option<u32>,
        pub corked: bool,
    }

    fn sink_inputs() -> Vec<SinkInput> {
        let run = |args: &[&str]| {
            Command::new("pactl")
                .args(args)
                .stdin(Stdio::null())
                .stderr(Stdio::null())
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        };
        if let Some(list) = run(&["-f", "json", "list", "sink-inputs"]).and_then(|j| parse_json(&j)) {
            return list;
        }
        run(&["list", "sink-inputs"]).map(|t| parse_text(&t)).unwrap_or_default()
    }

    /// `pactl -f json list sink-inputs`.
    pub fn parse_json(text: &str) -> Option<Vec<SinkInput>> {
        let items: Vec<serde_json::Value> = serde_json::from_str(text).ok()?;
        Some(
            items
                .iter()
                .filter_map(|item| {
                    let index = u32::try_from(item.get("index")?.as_u64()?).ok()?;
                    let props = item.get("properties");
                    let pid = props
                        .and_then(|p| p.get("application.process.id"))
                        .and_then(|v| v.as_str().map(str::to_owned).or_else(|| v.as_u64().map(|n| n.to_string())))
                        .and_then(|s| s.parse().ok());
                    let corked = item.get("corked").and_then(|v| v.as_bool()).unwrap_or(false);
                    Some(SinkInput { index, pid, corked })
                })
                .collect(),
        )
    }

    /// `pactl list sink-inputs` (older pactl, no JSON).
    pub fn parse_text(text: &str) -> Vec<SinkInput> {
        let mut out: Vec<SinkInput> = Vec::new();
        for line in text.lines() {
            let line = line.trim();
            if let Some(n) = line.strip_prefix("Sink Input #") {
                if let Ok(index) = n.trim().parse() {
                    out.push(SinkInput { index, pid: None, corked: false });
                }
            } else if let Some(last) = out.last_mut() {
                if let Some(v) = line.strip_prefix("application.process.id = ") {
                    last.pid = v.trim_matches('"').parse().ok();
                } else if let Some(v) = line.strip_prefix("Corked:") {
                    last.corked = v.trim() == "yes";
                }
            }
        }
        out
    }

    /// Whether `pid` is `ancestor` or one of its descendants.
    fn descends_from(mut pid: u32, ancestor: u32) -> bool {
        for _ in 0..64 {
            if pid == ancestor {
                return true;
            }
            match parent_of(pid) {
                Some(p) if p > 1 => pid = p,
                _ => return false,
            }
        }
        false
    }

    fn parent_of(pid: u32) -> Option<u32> {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        parse_ppid(&stat)
    }

    /// The parent in `/proc/<pid>/stat`: the second field after the
    /// command, which is in parentheses and may hold anything.
    pub fn parse_ppid(stat: &str) -> Option<u32> {
        let rest = &stat[stat.rfind(')')? + 1..];
        rest.split_whitespace().nth(1)?.parse().ok()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn parses_pactl_json() {
            let json = r#"[{"index":4914,"corked":false,"properties":{"application.process.id":"1690598","application.name":"Chromium"}},
                {"index":7,"corked":true,"properties":{}}]"#;
            assert_eq!(
                parse_json(json).unwrap(),
                vec![
                    SinkInput { index: 4914, pid: Some(1_690_598), corked: false },
                    SinkInput { index: 7, pid: None, corked: true },
                ]
            );
            assert!(parse_json("not json").is_none());
        }

        #[test]
        fn parses_pactl_text() {
            let text = "Sink Input #12\n\tDriver: PipeWire\n\tCorked: yes\n\tProperties:\n\t\tapplication.name = \"Chromium\"\n\t\tapplication.process.id = \"4321\"\n\nSink Input #13\n\tCorked: no\n";
            assert_eq!(
                parse_text(text),
                vec![
                    SinkInput { index: 12, pid: Some(4321), corked: true },
                    SinkInput { index: 13, pid: None, corked: false },
                ]
            );
        }

        #[test]
        fn reads_the_parent_from_proc_stat() {
            assert_eq!(parse_ppid("123 (chromium (audio)) S 456 123 123 0"), Some(456));
            let me = std::process::id();
            assert!(descends_from(me, me));
            assert_eq!(parent_of(me), Some(std::os::unix::process::parent_id()));
            assert!(!descends_from(1, me));
        }

        /// Records 2 s of the default monitor (sound or not):
        /// `cargo test -- --ignored records_the_default_monitor`.
        #[test]
        #[ignore]
        fn records_the_default_monitor() {
            let (child, rx) = spawn(Target::DefaultMonitor).expect("parec");
            let slot = Mutex::new(Some(child));
            let deadline = Instant::now() + Duration::from_secs(2);
            let mut analyzer = Analyzer::new();
            let (mut samples, mut steps, mut loud) = (0, 0, 0);
            while Instant::now() < deadline {
                if let Ok(chunk) = rx.recv_timeout(Duration::from_millis(200)) {
                    samples += chunk.len();
                    analyzer.push(&chunk, CHANNELS, |l| {
                        steps += 1;
                        loud += usize::from(l.loud);
                    });
                }
            }
            kill(&slot);
            eprintln!("recorded {samples} samples, {steps} steps ({loud} with sound); target now {:?}", resolve());
            assert!(steps > 100, "got {steps} steps from {samples} samples");
        }
    }
}

#[cfg(target_os = "macos")]
mod capture {
    //! Recording with a Core Audio process tap (macOS 14.2+), on a thread of
    //! its own.
    //!
    //! The tap mixes down to stereo what Spotish's own processes play (the
    //! browser's audio service is a child of its browser, which is a child
    //! of Spotish), without muting it, and only for this app (a private
    //! tap). It reaches an IO proc through a private aggregate device made
    //! for it. Which processes play is looked for again every few seconds:
    //! the audio service appears once the music starts, and the browser may
    //! be restarted. The first tap asks the user for "System Audio
    //! Recording" (`NSAudioCaptureUsageDescription`); refused, the tap
    //! hears silence and the light rests.
    //!
    //! The tap and its class are looked up at run time, not linked: on an
    //! older macOS they are missing, and the meter is unavailable.

    use std::{
        ffi::{CStr, c_void},
        ptr::NonNull,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
            mpsc,
        },
        time::{Duration, Instant},
    };

    use objc2::{AnyThread, rc::Retained, runtime::AnyClass};
    use objc2_core_audio::{
        AudioDeviceCreateIOProcID, AudioDeviceDestroyIOProcID, AudioDeviceIOProcID, AudioDeviceStart, AudioDeviceStop,
        AudioHardwareCreateAggregateDevice, AudioHardwareDestroyAggregateDevice, AudioObjectGetPropertyData,
        AudioObjectGetPropertyDataSize, AudioObjectID, AudioObjectPropertyAddress, CATapDescription,
        kAudioAggregateDeviceIsPrivateKey, kAudioAggregateDeviceNameKey, kAudioAggregateDeviceTapAutoStartKey,
        kAudioAggregateDeviceTapListKey, kAudioAggregateDeviceUIDKey, kAudioHardwarePropertyProcessObjectList,
        kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
        kAudioProcessPropertyPID, kAudioSubTapDriftCompensationKey, kAudioSubTapUIDKey, kAudioTapPropertyFormat,
    };
    use objc2_core_audio_types::{AudioBufferList, AudioStreamBasicDescription, AudioTimeStamp};
    use objc2_core_foundation::CFDictionary;
    use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSObject, NSString, NSUUID};
    use tokio::sync::mpsc::UnboundedSender;

    use super::{
        AudioFrame,
        analysis::{Analyzer, Emitter, SAMPLE_RATE},
    };

    /// How often the processes that play are looked for again.
    const RESOLVE_EVERY: Duration = Duration::from_secs(3);
    /// No samples for this long counts as silence.
    const STALL: Duration = Duration::from_secs(1);
    /// The tap's stereo mixdown.
    const CHANNELS: usize = 2;

    type CreateTap = unsafe extern "C-unwind" fn(*const CATapDescription, *mut AudioObjectID) -> i32;
    type DestroyTap = unsafe extern "C-unwind" fn(AudioObjectID) -> i32;

    /// The tap's two functions, where this macOS has them (14.2+).
    struct TapApi {
        create: CreateTap,
        destroy: DestroyTap,
    }

    fn tap_api() -> Option<&'static TapApi> {
        static API: std::sync::OnceLock<Option<TapApi>> = std::sync::OnceLock::new();
        API.get_or_init(|| {
            // SAFETY: dlsym on the process's own images; the names are
            // NUL-terminated, and the symbols, when present, have these
            // signatures (CoreAudio's AudioHardware.h).
            unsafe {
                let create = libc::dlsym(libc::RTLD_DEFAULT, c"AudioHardwareCreateProcessTap".as_ptr());
                let destroy = libc::dlsym(libc::RTLD_DEFAULT, c"AudioHardwareDestroyProcessTap".as_ptr());
                if create.is_null() || destroy.is_null() || AnyClass::get(c"CATapDescription").is_none() {
                    return None;
                }
                Some(TapApi {
                    create: std::mem::transmute::<*mut c_void, CreateTap>(create),
                    destroy: std::mem::transmute::<*mut c_void, DestroyTap>(destroy),
                })
            }
        })
        .as_ref()
    }

    pub fn available() -> bool {
        tap_api().is_some()
    }

    /// The running recorder; dropped, it stops (and its tap goes).
    pub struct Capture {
        stop: Arc<AtomicBool>,
    }

    impl Capture {
        pub fn start(tx: UnboundedSender<AudioFrame>) -> Option<Self> {
            tap_api()?;
            let stop = Arc::new(AtomicBool::new(false));
            let s = stop.clone();
            std::thread::Builder::new()
                .name("ytmfast-audio".into())
                .spawn(move || record(tx, s))
                .map_err(|e| log::warn!("audio meter: no thread: {e}"))
                .ok()?;
            Some(Capture { stop })
        }
    }

    impl Drop for Capture {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
        }
    }

    /// The recording thread: (re)taps the processes that play, analyzes
    /// what the tap hears, sends frames. The tap is made and ended here.
    fn record(tx: UnboundedSender<AudioFrame>, stop: Arc<AtomicBool>) {
        let mut analyzer = Analyzer::new();
        let mut emitter = Emitter::new();
        let mut tap: Option<Tap> = None;
        let mut tapped: Vec<AudioObjectID> = Vec::new();
        let mut resampler = Resampler::default();
        let mut next_resolve = Instant::now();
        let mut last_data = Instant::now();
        let send = |frame: Option<AudioFrame>| frame.is_none_or(|f| tx.send(f).is_ok());

        while !stop.load(Ordering::SeqCst) {
            if Instant::now() >= next_resolve {
                next_resolve = Instant::now() + RESOLVE_EVERY;
                let wanted = own_processes();
                if wanted != tapped {
                    tap = None;
                    tapped.clear();
                    if !wanted.is_empty() {
                        match Tap::start(&wanted) {
                            Ok(t) => {
                                log::debug!("audio meter: tapping {} process(es) at {} Hz", wanted.len(), t.rate);
                                resampler = Resampler::new(t.rate);
                                tap = Some(t);
                                tapped = wanted;
                                last_data = Instant::now();
                            }
                            Err(e) => log::warn!("audio meter: cannot tap the browser: {e}"),
                        }
                    }
                }
            }
            let Some(t) = tap.as_ref() else {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            };
            match t.chunks.recv_timeout(Duration::from_millis(100)) {
                Ok(samples) => {
                    last_data = Instant::now();
                    let samples = resampler.run(&samples);
                    let mut open = true;
                    analyzer.push(&samples, CHANNELS, |levels| open &= send(emitter.step(levels)));
                    if !open {
                        break;
                    }
                }
                Err(_) => {
                    if last_data.elapsed() >= STALL && !send(emitter.silence()) {
                        break;
                    }
                }
            }
        }
    }

    /// Stereo frames from the tap's rate to the analysis's (48 kHz),
    /// linearly: enough for levels and a 16-band spectrum.
    #[derive(Default)]
    struct Resampler {
        /// Input frames per output frame; 0: none needed.
        step: f64,
        /// Where the next output frame falls, in input frames from the
        /// start of the pending ones.
        at: f64,
        /// The last input frame of the previous chunk.
        last: [f32; CHANNELS],
    }

    impl Resampler {
        fn new(rate: f64) -> Self {
            let step = rate / f64::from(SAMPLE_RATE);
            Resampler { step: if (step - 1.0).abs() < 1e-6 { 0.0 } else { step }, ..Resampler::default() }
        }

        fn run(&mut self, interleaved: &[f32]) -> Vec<f32> {
            if self.step == 0.0 {
                return interleaved.to_vec();
            }
            let frames = interleaved.len() / CHANNELS;
            // Frame -1 is the previous chunk's last, so output never skips
            // the seam between chunks.
            let frame = |i: isize, c: usize| if i < 0 { self.last[c] } else { interleaved[i as usize * CHANNELS + c] };
            let mut out = Vec::with_capacity((frames as f64 / self.step) as usize * CHANNELS + CHANNELS);
            let mut at = self.at;
            while at < frames as f64 - 1.0 {
                let i = at.floor();
                let t = (at - i) as f32;
                let i = i as isize;
                for c in 0..CHANNELS {
                    out.push(frame(i, c) + (frame(i + 1, c) - frame(i, c)) * t);
                }
                at += self.step;
            }
            if frames > 0 {
                for c in 0..CHANNELS {
                    self.last[c] = interleaved[(frames - 1) * CHANNELS + c];
                }
            }
            self.at = at - frames as f64;
            out
        }
    }

    fn address(selector: u32) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress {
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        }
    }

    /// A fixed-size property of `object` (a plain C value: all zeros is
    /// one).
    fn property<T: Copy>(object: AudioObjectID, selector: u32) -> Option<T> {
        let address = address(selector);
        // SAFETY: T is a plain C value (an integer, a struct of them).
        let mut value: T = unsafe { std::mem::zeroed() };
        let mut size = std::mem::size_of::<T>() as u32;
        // SAFETY: `value` is a `T` of `size` bytes, as the property is.
        let status = unsafe {
            AudioObjectGetPropertyData(
                object,
                NonNull::from(&address),
                0,
                std::ptr::null(),
                NonNull::from(&mut size),
                NonNull::from(&mut value).cast(),
            )
        };
        (status == 0).then_some(value)
    }

    /// The process objects of Core Audio (the processes that use audio)
    /// that are Spotish's descendants, sorted.
    fn own_processes() -> Vec<AudioObjectID> {
        let address = address(kAudioHardwarePropertyProcessObjectList);
        let mut size = 0u32;
        // SAFETY: the system object's process list, an array of
        // AudioObjectIDs `size` bytes long.
        let objects = unsafe {
            if AudioObjectGetPropertyDataSize(
                kAudioObjectSystemObject as AudioObjectID,
                NonNull::from(&address),
                0,
                std::ptr::null(),
                NonNull::from(&mut size),
            ) != 0
            {
                return Vec::new();
            }
            let mut objects = vec![0 as AudioObjectID; size as usize / std::mem::size_of::<AudioObjectID>()];
            if AudioObjectGetPropertyData(
                kAudioObjectSystemObject as AudioObjectID,
                NonNull::from(&address),
                0,
                std::ptr::null(),
                NonNull::from(&mut size),
                NonNull::new_unchecked(objects.as_mut_ptr()).cast(),
            ) != 0
            {
                return Vec::new();
            }
            objects.truncate(size as usize / std::mem::size_of::<AudioObjectID>());
            objects
        };
        let me = std::process::id() as libc::pid_t;
        let mut own: Vec<_> = objects
            .into_iter()
            .filter(|&object| {
                property::<libc::pid_t>(object, kAudioProcessPropertyPID).is_some_and(|pid| descends_from(pid, me))
            })
            .collect();
        own.sort_unstable();
        own
    }

    /// Whether `pid` is a descendant of `ancestor` (not itself).
    fn descends_from(mut pid: libc::pid_t, ancestor: libc::pid_t) -> bool {
        for _ in 0..16 {
            let Some(parent) = parent_of(pid) else { return false };
            if parent == ancestor {
                return true;
            }
            if parent <= 1 {
                return false;
            }
            pid = parent;
        }
        false
    }

    fn parent_of(pid: libc::pid_t) -> Option<libc::pid_t> {
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
        // SAFETY: `info` is a proc_bsdinfo of `size` bytes.
        let n = unsafe {
            libc::proc_pidinfo(pid, libc::PROC_PIDTBSDINFO, 0, (&raw mut info).cast(), size)
        };
        (n == size).then_some(info.pbi_ppid as libc::pid_t)
    }

    fn key(name: &CStr) -> Retained<NSString> {
        NSString::from_str(name.to_str().unwrap_or_default())
    }

    /// A tap on some processes, its aggregate device and IO proc; dropped,
    /// all three go.
    struct Tap {
        tap: AudioObjectID,
        device: AudioObjectID,
        proc_id: AudioDeviceIOProcID,
        /// The IO proc's state, freed after the proc is destroyed.
        state: *mut ProcState,
        rate: f64,
        chunks: mpsc::Receiver<Vec<f32>>,
    }

    /// What the IO proc reads from: where its samples go.
    struct ProcState {
        tx: mpsc::Sender<Vec<f32>>,
    }

    impl Tap {
        fn start(processes: &[AudioObjectID]) -> Result<Self, String> {
            let api = tap_api().ok_or("no process taps on this macOS")?;
            let ids: Vec<Retained<NSNumber>> = processes.iter().map(|&p| NSNumber::new_u32(p)).collect();
            let ids = NSArray::from_retained_slice(&ids);
            // SAFETY: CATapDescription exists (checked by `tap_api`); the
            // array holds NSNumbers of process objects, as the initializer
            // takes.
            let description = unsafe {
                let d = CATapDescription::initStereoMixdownOfProcesses(CATapDescription::alloc(), &ids);
                d.setPrivate(true);
                d
            };
            let mut tap: AudioObjectID = 0;
            // SAFETY: a valid description and out pointer.
            let status = unsafe { (api.create)(Retained::as_ptr(&description), &mut tap) };
            if status != 0 {
                return Err(format!("AudioHardwareCreateProcessTap: {status}"));
            }
            let mut this = Tap {
                tap,
                device: 0,
                proc_id: None,
                state: std::ptr::null_mut(),
                rate: 0.0,
                chunks: mpsc::channel().1,
            };
            let format: AudioStreamBasicDescription =
                property(tap, kAudioTapPropertyFormat).ok_or("the tap has no format")?;
            this.rate = format.mSampleRate;
            // SAFETY: the tap's UUID, which the aggregate device names.
            let tap_uid = unsafe { description.UUID() }.UUIDString();
            let sub_tap: Retained<NSDictionary<NSString, NSObject>> = NSDictionary::from_retained_objects(
                &[&*key(kAudioSubTapUIDKey), &*key(kAudioSubTapDriftCompensationKey)],
                &[Retained::into_super(tap_uid), Retained::into_super(Retained::into_super(NSNumber::new_bool(true)))],
            );
            let taps = NSArray::from_retained_slice(&[sub_tap]);
            let device_uid = NSUUID::new().UUIDString();
            let one = || Retained::into_super(Retained::into_super(NSNumber::new_i32(1)));
            let description: Retained<NSDictionary<NSString, NSObject>> = NSDictionary::from_retained_objects(
                &[
                    &*key(kAudioAggregateDeviceNameKey),
                    &*key(kAudioAggregateDeviceUIDKey),
                    &*key(kAudioAggregateDeviceIsPrivateKey),
                    &*key(kAudioAggregateDeviceTapAutoStartKey),
                    &*key(kAudioAggregateDeviceTapListKey),
                ],
                &[
                    Retained::into_super(NSString::from_str("Spotish audio meter")),
                    Retained::into_super(device_uid),
                    one(),
                    one(),
                    Retained::into_super(taps),
                ],
            );
            let mut device: AudioObjectID = 0;
            // SAFETY: an NSDictionary is a CFDictionary (toll-free
            // bridged), of the keys and values the call takes.
            let status = unsafe {
                AudioHardwareCreateAggregateDevice(
                    &*(Retained::as_ptr(&description) as *const CFDictionary),
                    NonNull::from(&mut device),
                )
            };
            if status != 0 {
                return Err(format!("AudioHardwareCreateAggregateDevice: {status}"));
            }
            this.device = device;
            let (tx, rx) = mpsc::channel();
            this.chunks = rx;
            this.state = Box::into_raw(Box::new(ProcState { tx }));
            let mut proc_id: AudioDeviceIOProcID = None;
            // SAFETY: `io_proc` reads `state` as a ProcState, which lives
            // until the proc is destroyed (`drop`).
            let status = unsafe {
                AudioDeviceCreateIOProcID(device, Some(io_proc), this.state.cast(), NonNull::from(&mut proc_id))
            };
            if status != 0 {
                return Err(format!("AudioDeviceCreateIOProcID: {status}"));
            }
            this.proc_id = proc_id;
            // SAFETY: the device and the proc made above.
            let status = unsafe { AudioDeviceStart(device, proc_id) };
            if status != 0 {
                return Err(format!("AudioDeviceStart: {status}"));
            }
            Ok(this)
        }
    }

    impl Drop for Tap {
        fn drop(&mut self) {
            // SAFETY: each made by `start` (0 / None: not made); the proc is
            // stopped and destroyed before its state is freed.
            unsafe {
                if self.device != 0 {
                    if self.proc_id.is_some() {
                        AudioDeviceStop(self.device, self.proc_id);
                        AudioDeviceDestroyIOProcID(self.device, self.proc_id);
                    }
                    AudioHardwareDestroyAggregateDevice(self.device);
                }
                if !self.state.is_null() {
                    drop(Box::from_raw(self.state));
                }
                if let Some(api) = tap_api() {
                    (api.destroy)(self.tap);
                }
            }
        }
    }

    /// The aggregate device's IO proc: copies the tap's input out as
    /// interleaved stereo (one buffer of interleaved frames, or one buffer
    /// per channel).
    unsafe extern "C-unwind" fn io_proc(
        _device: AudioObjectID,
        _now: NonNull<AudioTimeStamp>,
        input: NonNull<AudioBufferList>,
        _input_time: NonNull<AudioTimeStamp>,
        _output: NonNull<AudioBufferList>,
        _output_time: NonNull<AudioTimeStamp>,
        state: *mut c_void,
    ) -> i32 {
        // SAFETY: `state` is the ProcState `start` gave, alive while the
        // proc is; `input` is the device's buffer list for this cycle.
        let (state, list) = unsafe { (&*(state as *const ProcState), input.as_ref()) };
        let count = list.mNumberBuffers as usize;
        // SAFETY: the list holds `count` buffers (a C flexible array).
        let buffers = unsafe { std::slice::from_raw_parts(list.mBuffers.as_ptr(), count) };
        let floats = |b: &objc2_core_audio_types::AudioBuffer| -> &[f32] {
            if b.mData.is_null() {
                return &[];
            }
            // SAFETY: the tap's samples are 32-bit floats, `mDataByteSize`
            // bytes of them.
            unsafe { std::slice::from_raw_parts(b.mData as *const f32, b.mDataByteSize as usize / 4) }
        };
        let samples = match buffers {
            [one] if one.mNumberChannels as usize == CHANNELS => floats(one).to_vec(),
            [one] => floats(one).iter().flat_map(|&s| [s, s]).collect(),
            [left, right, ..] => floats(left).iter().zip(floats(right)).flat_map(|(&l, &r)| [l, r]).collect(),
            [] => return 0,
        };
        if !samples.is_empty() {
            let _ = state.tx.send(samples);
        }
        0
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn resamples_44_1_khz_to_48() {
            let mut r = Resampler::new(44_100.0);
            // A ramp over two chunks: the output stays a ramp, at 48 kHz.
            let chunk = |from: usize| (from..from + 441).flat_map(|i| [i as f32, -(i as f32)]).collect::<Vec<_>>();
            let mut out = r.run(&chunk(0));
            out.extend(r.run(&chunk(441)));
            let frames = out.len() / CHANNELS;
            assert!((955..=961).contains(&frames), "{frames} frames");
            for w in out.chunks(CHANNELS).collect::<Vec<_>>().windows(2) {
                let step = w[1][0] - w[0][0];
                assert!((step - 44.1 / 48.0).abs() < 1e-3, "step {step}");
                assert_eq!(w[1][1], -w[1][0]);
            }
        }

        #[test]
        fn passes_48_khz_through() {
            let mut r = Resampler::new(48_000.0);
            let samples: Vec<f32> = (0..96).map(|i| i as f32).collect();
            assert_eq!(r.run(&samples), samples);
        }

        /// Taps a child that plays a sound and hears it. Needs a speaker
        /// and the "System Audio Recording" permission for the terminal:
        /// `cargo test --lib audio -- --ignored --nocapture`.
        #[test]
        #[ignore]
        fn taps_a_child_that_plays() {
            if !available() {
                eprintln!("no process taps on this macOS");
                return;
            }
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
            let mut child = std::process::Command::new("afplay")
                .args(["-t", "6", "/System/Library/Sounds/Submarine.aiff"])
                .spawn()
                .unwrap();
            let capture = Capture::start(tx).unwrap();
            let until = Instant::now() + Duration::from_secs(8);
            let mut loudest = 0.0f64;
            while Instant::now() < until {
                while let Ok(frame) = rx.try_recv() {
                    loudest = loudest.max(frame.level);
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            drop(capture);
            let _ = child.kill();
            let _ = child.wait();
            eprintln!("loudest level {loudest}");
            assert!(loudest > 0.05, "heard nothing (level {loudest})");
        }

        #[test]
        fn this_process_is_not_its_own_descendant() {
            let me = std::process::id() as libc::pid_t;
            assert!(!descends_from(me, me));
            assert!(parent_of(me).is_some());
        }
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
mod capture {
    //! No recording here yet: see the module's notes.

    use tokio::sync::mpsc::UnboundedSender;

    use super::AudioFrame;

    pub fn available() -> bool {
        false
    }

    pub struct Capture;

    impl Capture {
        pub fn start(_tx: UnboundedSender<AudioFrame>) -> Option<Self> {
            None
        }
    }
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos", target_os = "windows")))]
mod tests {
    use super::analysis::*;

    fn run(signal: impl Fn(usize) -> f32, seconds: f32) -> Vec<Levels> {
        let n = (SAMPLE_RATE * seconds) as usize;
        let stereo: Vec<f32> = (0..n).flat_map(|i| {
            let s = signal(i);
            [s, s]
        }).collect();
        let mut a = Analyzer::new();
        let mut out = Vec::new();
        // In parec-sized chunks, as it arrives.
        for chunk in stereo.chunks(960) {
            a.push(chunk, 2, |l| out.push(*l));
        }
        out
    }

    fn sine(hz: f32, amp: f32) -> impl Fn(usize) -> f32 {
        move |i| amp * (2.0 * std::f32::consts::PI * hz * i as f32 / SAMPLE_RATE).sin()
    }

    #[test]
    fn steps_120_times_a_second() {
        let steps = run(|_| 0.0, 1.0).len();
        assert!((117..=120).contains(&steps), "{steps}");
    }

    #[test]
    fn silence_is_zero() {
        for l in run(|_| 0.0, 1.0) {
            assert!(!l.loud);
            assert_eq!(l.frame(), crate::audio::AudioFrame::zero());
        }
    }

    #[test]
    fn a_low_sine_is_bass() {
        let last = *run(sine(60.0, 0.5), 1.0).last().unwrap();
        assert!(last.bass > 0.8, "{last:?}");
        assert!(last.mid < 0.2 && last.treble < 0.1, "{last:?}");
        assert!(last.bands[0] > 0.8 || last.bands[1] > 0.8, "{last:?}");
        assert!(last.bands[8..].iter().all(|b| *b < 0.1), "{last:?}");
        assert!(last.level > 0.8, "{last:?}");
    }

    #[test]
    fn a_high_sine_is_treble() {
        let last = *run(sine(5_000.0, 0.5), 1.0).last().unwrap();
        assert!(last.treble > 0.8, "{last:?}");
        assert!(last.bass < 0.1 && last.mid < 0.2, "{last:?}");
        // 5 kHz: band 11 (≈4.4–6.0 kHz).
        let top = (0..16).max_by(|a, b| last.bands[*a].total_cmp(&last.bands[*b])).unwrap();
        assert!((10..=12).contains(&top), "{last:?}");
        assert!(last.bands[..6].iter().all(|b| *b < 0.1), "{last:?}");
    }

    #[test]
    fn a_quiet_track_moves_like_a_loud_one() {
        let loud = *run(sine(60.0, 0.5), 1.0).last().unwrap();
        let quiet = *run(sine(60.0, 0.005), 1.0).last().unwrap();
        assert!((loud.bass - quiet.bass).abs() < 0.05, "{loud:?} {quiet:?}");
        assert!((loud.level - quiet.level).abs() < 0.05, "{loud:?} {quiet:?}");
    }

    #[test]
    fn values_rise_fast_and_fall_slowly() {
        // 0.5 s of tone, then silence.
        let steps = run(|i| if i < 24_000 { sine(60.0, 0.5)(i) } else { 0.0 }, 1.0);
        // ~30 ms in (attack): mostly there.
        assert!(steps[4].bass > 0.5, "{:?}", steps[4]);
        // ~100 ms after it ends (release ~250 ms): still well above 0.
        let after = steps.iter().position(|l| !l.loud).unwrap();
        assert!(steps[after].bass > 0.5, "{:?}", steps[after]);
        assert!(steps.last().unwrap().bass < 0.2);
    }

    #[test]
    fn clicks_are_beats() {
        // A click every 500 ms for 4 s over a soft hum (so it is never
        // silent between them).
        let hum = sine(440.0, 0.01);
        let steps = run(|i| hum(i) + if i % 24_000 == 1_000 { 0.9 } else { 0.0 }, 4.0);
        let onsets: Vec<usize> = steps.iter().enumerate().filter(|(_, l)| l.onset).map(|(i, _)| i).collect();
        assert_eq!(onsets.len(), 8, "{onsets:?}");
        // One per click, ~60 steps apart.
        for pair in onsets.windows(2) {
            assert!((58..=62).contains(&(pair[1] - pair[0])), "{onsets:?}");
        }
        // The pulse: 1 on the onset, gone 250 ms later.
        let first = onsets[0];
        assert_eq!(steps[first].beat, 1.0);
        assert!(steps[first + 12].beat > 0.3);
        assert_eq!(steps[first + 30].beat, 0.0);
    }

    #[test]
    fn a_steady_tone_has_no_beats() {
        let onsets = run(sine(60.0, 0.5), 3.0).iter().filter(|l| l.onset).count();
        assert!(onsets <= 1, "{onsets}");
    }

    #[test]
    fn the_emitter_halves_and_pauses_on_silence() {
        let mut e = Emitter::new();
        let tone = run(sine(200.0, 0.3), 1.0);
        let sent = tone.iter().filter(|l| e.step(l).is_some()).count();
        assert!((55..=62).contains(&sent), "{sent}");
        let quiet = run(|_| 0.0, 2.0);
        let frames: Vec<_> = quiet.iter().filter_map(|l| e.step(l)).collect();
        // A second's fade, then one zero frame, then nothing.
        assert!(frames.len() <= 62, "{}", frames.len());
        assert_eq!(frames.last(), Some(&crate::audio::AudioFrame::zero()));
        assert_eq!(e.silence(), None);
        // Before any sound, nothing at all.
        let mut fresh = Emitter::new();
        assert!(quiet.iter().all(|l| fresh.step(l).is_none()));
    }
}
