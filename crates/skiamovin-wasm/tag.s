# Defines the C++ exception tag that Rust's std references. Skiamovin's wasm build uses panic=abort,
# so the tag exists only to satisfy the linker.
.tagtype __cpp_exception i32
.globl __cpp_exception
__cpp_exception:
