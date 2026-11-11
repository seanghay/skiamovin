// The hero object, raymarched in SkSL: an anodized slab (like an app icon) with a raised chrome ring and a
// glowing glass core in the brand gradient, lit by studio light strips.
export const HERO = `
uniform float2 iResolution;
uniform float iTime;
uniform float yaw;      // radians
uniform float pitch;    // radians
uniform float dist;     // camera distance
uniform float sweep;    // 0..1 moves a light strip across the reflections
uniform float glow;     // core emission
uniform float2 offset;  // object offset in screen space (pixels)

float sdRoundBox(float3 p, float3 b, float r) { float3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
float sdTorus(float3 p, float2 t) { float2 q = float2(length(p.xy) - t.x, p.z); return length(q) - t.y; }
float3 rotY(float3 p, float a) { float c = cos(a), s = sin(a); return float3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
float3 rotX(float3 p, float a) { float c = cos(a), s = sin(a); return float3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }

// Returns distance; material in m: 0 slab, 1 chrome ring, 2 core.
float map(float3 p, out float m) {
  p = rotX(rotY(p, yaw), pitch);
  float slab = sdRoundBox(p, float3(1.0, 1.0, 0.16), 0.38);
  float ring = sdTorus(p - float3(0, 0, -0.17), float2(0.56, 0.085));
  float core = length(p - float3(0, 0, -0.12)) - 0.26;
  float d = slab; m = 0;
  if (ring < d) { d = ring; m = 1; }
  if (core < d) { d = core; m = 2; }
  return d;
}

float3 env(float3 d) {
  // Soft studio: dark falloff plus two light strips (top and right) and a moving sweep.
  float3 c = float3(0.02, 0.02, 0.025) + 0.22 * smoothstep(-0.3, 1.0, d.y) * float3(0.8, 0.82, 0.9);
  c += 1.6 * smoothstep(0.35, 0.75, d.y) * smoothstep(0.9, 0.3, abs(d.x)) * float3(1.0, 0.98, 0.95);   // top softbox
  c += 0.35 * smoothstep(-0.2, -0.6, d.y) * float3(0.55, 0.45, 0.7);                                      // floor bounce
  c += 2.2 * smoothstep(0.08, 0.0, abs(d.y - 0.75)) * smoothstep(0.7, 0.2, abs(d.x)) * float3(1.0, 0.98, 0.95);
  c += 1.2 * smoothstep(0.06, 0.0, abs(d.x - 0.8)) * smoothstep(0.8, 0.1, abs(d.y)) * float3(0.85, 0.9, 1.0);
  float sx = mix(-1.2, 1.2, sweep);
  c += 3.0 * smoothstep(0.05, 0.0, abs(d.x - sx + 0.3 * d.y)) * smoothstep(1.0, 0.3, abs(d.y));
  return c;
}

float3 brand(float t) {
  float3 a = float3(0.486, 0.227, 0.929), b = float3(0.859, 0.153, 0.467), c = float3(0.976, 0.451, 0.086);
  return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, t * 2.0 - 1.0);
}

half4 shade(float2 frag) {
  float2 uv = (frag - 0.5 * iResolution - offset) / iResolution.y;
  float3 ro = float3(0, 0, -dist);
  float3 rd = normalize(float3(uv, 1.6));
  float t = 0.0, m = 0.0;
  bool hit = false;
  for (int i = 0; i < 96; i++) {
    float3 p = ro + rd * t;
    float d = map(p, m);
    if (d < 0.0008) { hit = true; break; }
    t += d * 0.9;
    if (t > 12.0) break;
  }
  if (!hit) return half4(0);
  float3 p = ro + rd * t;
  float mm;
  const float e = 0.0008;
  float3 n = normalize(float3(
    map(p + float3(e, 0, 0), mm) - map(p - float3(e, 0, 0), mm),
    map(p + float3(0, e, 0), mm) - map(p - float3(0, e, 0), mm),
    map(p + float3(0, 0, e), mm) - map(p - float3(0, 0, e), mm)));
  float3 r = reflect(rd, n);
  float fres = pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
  float3 key = normalize(float3(-0.6, 0.8, -0.7));
  float diff = max(dot(n, key), 0.0);
  float3 col;
  if (m < 0.5) {
    // Anodized aluminum: tinted, slightly rough reflection.
    float3 base = float3(0.10, 0.075, 0.16);
    col = base * (0.25 + 0.9 * diff) + env(r) * mix(float3(0.28, 0.22, 0.42), float3(1.0), fres) * 0.55;
  } else if (m < 1.5) {
    // Polished chrome.
    col = env(r) * 0.92 + float3(0.05) * diff + float3(0.03);
  } else {
    // Glass core: brand gradient by angle, emissive, with a crisp reflection.
    float3 q = rotX(rotY(p, yaw), pitch);
    float a = atan(q.y, q.x) + 0.6 * iTime;
    float g = 0.5 + 0.5 * sin(a + 1.5 * q.y);
    col = brand(g) * (0.35 + glow) * (0.7 + 0.5 * max(dot(n, -rd), 0.0)) + env(r) * (0.12 + 0.88 * fres);
  }
  // Tone map.
  col = col / (1.0 + col);
  col = pow(col, float3(0.85));
  return half4(half3(col), 1);
}

half4 main(float2 frag) {
  // 2x supersampling for clean silhouettes.
  return (shade(frag + float2(-0.25, -0.25)) + shade(frag + float2(0.25, 0.25))) * 0.5;
}`;
