//! Every WGSL shader the TSX draws with (`const NAME = /* wgsl */ \`...\``
//! in `src/**/*.tsx`) compiles with NSH's own compiler: a mistake shows here,
//! not as a blank view at run time. `${NAME}` pieces are filled in from the
//! file's other WGSL constants.

use std::{collections::HashMap, fs, path::Path};

fn tsx_files(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    for entry in fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            tsx_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "tsx" || e == "ts") {
            out.push(path);
        }
    }
}

/// The file's WGSL constants by name, as written.
fn constants(text: &str) -> Vec<(String, String)> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find("/* wgsl */ `") {
        let before = &rest[..at];
        let name = before
            .rsplit("const ")
            .next()
            .and_then(|s| s.split_whitespace().next())
            .unwrap_or("?")
            .trim_end_matches('=')
            .to_string();
        let body = &rest[at + "/* wgsl */ `".len()..];
        let end = body.find('`').expect("closing backtick");
        found.push((name, body[..end].to_string()));
        rest = &body[end + 1..];
    }
    found
}

#[test]
fn every_shader_compiles() {
    let mut files = Vec::new();
    tsx_files(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/src")), &mut files);
    let mut checked = 0;
    let mut failures = Vec::new();
    for file in files {
        let text = fs::read_to_string(&file).unwrap();
        let consts = constants(&text);
        let by_name: HashMap<_, _> = consts.iter().cloned().collect();
        for (name, body) in &consts {
            // A piece others include (`${NAME}`) is checked as part of them.
            if text.contains(&format!("${{{name}}}")) {
                continue;
            }
            let mut source = body.clone();
            for (piece, value) in &by_name {
                source = source.replace(&format!("${{{piece}}}"), value);
            }
            if !source.contains("fn shade(") {
                continue;
            }
            checked += 1;
            if let Err(e) = nsh_core::shader::Shader::compile(&source) {
                failures.push(format!("{}: {name}: {e}", file.display()));
            }
        }
    }
    assert!(failures.is_empty(), "shaders that do not compile:\n{}", failures.join("\n\n"));
    eprintln!("compiled {checked} shaders");
    assert!(checked > 0, "no shaders found");
}
