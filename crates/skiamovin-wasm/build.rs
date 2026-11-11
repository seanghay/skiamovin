use std::fs;
use std::path::Path;

fn main() {
    let target = std::env::var("TARGET").unwrap_or_default();
    if !target.contains("emscripten") {
        return;
    }
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    cc::Build::new().cpp(true).file(dir.join("shim.cpp")).flag("-std=c++20").compile("skiamovin_shim");
    cc::Build::new().file(dir.join("tag.s")).flag("-mexception-handling").compile("skiamovin_tag");
    println!("cargo:rerun-if-changed=tag.s");
    println!("cargo:rerun-if-changed=shim.cpp");
    let mut exports: Vec<String> =
        fs::read_to_string(dir.join("exports.txt")).unwrap_or_default().lines().map(String::from).collect();
    for extra in [
        "_skm_alloc",
        "_skm_free",
        "_skm_ret_len",
        "_skm_ret_free",
        "_skm_err_len",
        "_skm_err_ptr",
        "_skm_err_clear",
        "_skm_taffy_compute_layout_with_measure",
        "_main",
        "_malloc",
        "_free",
    ] {
        exports.push(extra.to_string());
    }
    let list = format!("[{}]", exports.iter().map(|e| format!("'{e}'")).collect::<Vec<_>>().join(","));
    let out_dir = std::env::var("OUT_DIR").unwrap();
    let exports_file = Path::new(&out_dir).join("exported_functions.txt");
    fs::write(&exports_file, list).unwrap();
    let args = [
        format!("-sEXPORTED_FUNCTIONS=@{}", exports_file.display()),
        "-sEXPORTED_RUNTIME_METHODS=['GL','HEAPU8','HEAPF32','HEAPU32','HEAP32','HEAPF64']".to_string(),
        "-sMODULARIZE=1".into(),
        "-sEXPORT_ES6=1".into(),
        "-sEXPORT_NAME=createSkiamovin".into(),
        "-sALLOW_MEMORY_GROWTH=1".into(),
        "-sMAXIMUM_MEMORY=4GB".into(),
        "-sINITIAL_MEMORY=64MB".into(),
        "-sSTACK_SIZE=5MB".into(),
        "-sMAX_WEBGL_VERSION=2".into(),
        "-sMIN_WEBGL_VERSION=2".into(),
        "-sFULL_ES3=1".into(),
        "-sENVIRONMENT=web,worker,node".into(),
        "-sINVOKE_RUN=0".into(),
        "-sEXIT_RUNTIME=0".into(),
        "-sFILESYSTEM=0".into(),
        "-sSUPPORT_LONGJMP=emscripten".into(),
        "-sOFFSCREENCANVAS_SUPPORT=1".into(),
        format!("--js-library={}", dir.join("library.js").display()),
        "-lGL".into(),
    ];
    for a in args {
        println!("cargo:rustc-link-arg-bins={a}");
    }
    println!("cargo:rerun-if-changed=exports.txt");
    println!("cargo:rerun-if-changed=library.js");
}
