// Compatibility shims for linking the prebuilt Skia (built with a newer emsdk) against this toolchain.
#include <cstddef>
#include <cstdlib>
#include <functional>

namespace std {
inline namespace __2 {
// libc++ >= 20 moved the byte hash out of line. Provide it using the same algorithm the headers use.
[[gnu::visibility("default")]] size_t __hash_memory(const void* ptr, size_t size) noexcept {
  return __murmur2_or_cityhash<size_t>()(ptr, size);
}
}  // namespace __2
}  // namespace std

