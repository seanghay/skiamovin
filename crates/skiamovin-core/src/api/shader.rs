use crate::convert::{blend_mode, color4f, colors4f, matrix_opt, tile_mode};
use crate::handles::{cloned, get, put};
use crate::R;
use skia_safe::{
    gradient_shader::{self, GradientShaderColors},
    perlin_noise_shader, shaders, Blender, ColorFilter, Data, ISize, RuntimeEffect, Shader,
};

fn pos_opt(p: &[f32]) -> Option<&[f32]> {
    if p.is_empty() {
        None
    } else {
        Some(p)
    }
}

/// colors = flat RGBA floats; positions = [] for even spacing; m = [] for identity. flags bit 0: interpolate premul.
pub fn shader_linear_gradient(
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    colors: &[f32],
    positions: &[f32],
    tile: u32,
    flags: u32,
    m: &[f32],
) -> R<u32> {
    let cols = colors4f(colors);
    let m = matrix_opt(m)?;
    let s = gradient_shader::linear(
        ((x0, y0), (x1, y1)),
        GradientShaderColors::ColorsInSpace(&cols, None),
        pos_opt(positions),
        tile_mode(tile),
        gradient_shader::Flags::from_bits_truncate(flags),
        m.as_ref(),
    )
    .ok_or("could not create linear gradient")?;
    Ok(put(s))
}

pub fn shader_radial_gradient(
    cx: f32,
    cy: f32,
    radius: f32,
    colors: &[f32],
    positions: &[f32],
    tile: u32,
    flags: u32,
    m: &[f32],
) -> R<u32> {
    let cols = colors4f(colors);
    let m = matrix_opt(m)?;
    let s = gradient_shader::radial(
        (cx, cy),
        radius,
        GradientShaderColors::ColorsInSpace(&cols, None),
        pos_opt(positions),
        tile_mode(tile),
        gradient_shader::Flags::from_bits_truncate(flags),
        m.as_ref(),
    )
    .ok_or("could not create radial gradient")?;
    Ok(put(s))
}

pub fn shader_two_point_conical_gradient(
    sx: f32,
    sy: f32,
    sr: f32,
    ex: f32,
    ey: f32,
    er: f32,
    colors: &[f32],
    positions: &[f32],
    tile: u32,
    flags: u32,
    m: &[f32],
) -> R<u32> {
    let cols = colors4f(colors);
    let m = matrix_opt(m)?;
    let s = gradient_shader::two_point_conical(
        (sx, sy),
        sr,
        (ex, ey),
        er,
        GradientShaderColors::ColorsInSpace(&cols, None),
        pos_opt(positions),
        tile_mode(tile),
        gradient_shader::Flags::from_bits_truncate(flags),
        m.as_ref(),
    )
    .ok_or("could not create conical gradient")?;
    Ok(put(s))
}

pub fn shader_sweep_gradient(
    cx: f32,
    cy: f32,
    colors: &[f32],
    positions: &[f32],
    tile: u32,
    start_angle: f32,
    end_angle: f32,
    flags: u32,
    m: &[f32],
) -> R<u32> {
    let cols = colors4f(colors);
    let m = matrix_opt(m)?;
    let s = gradient_shader::sweep(
        (cx, cy),
        GradientShaderColors::ColorsInSpace(&cols, None),
        pos_opt(positions),
        tile_mode(tile),
        (start_angle, end_angle),
        gradient_shader::Flags::from_bits_truncate(flags),
        m.as_ref(),
    )
    .ok_or("could not create sweep gradient")?;
    Ok(put(s))
}

pub fn shader_color(rgba: &[f32]) -> R<u32> {
    let c = color4f(rgba)?;
    Ok(put(shaders::color_in_space(c, skia_safe::ColorSpace::new_srgb())))
}

pub fn shader_blend(mode: u32, dst: u32, src: u32) -> R<u32> {
    let d = cloned::<Shader>(dst)?;
    let s = cloned::<Shader>(src)?;
    Ok(put(shaders::blend(Blender::mode(blend_mode(mode)), d, s)))
}

pub fn shader_fractal_noise(fx: f32, fy: f32, octaves: u32, seed: f32, tile_w: i32, tile_h: i32) -> R<u32> {
    let tile = if tile_w > 0 && tile_h > 0 { Some(ISize::new(tile_w, tile_h)) } else { None };
    let s = perlin_noise_shader::fractal_noise((fx, fy), octaves as usize, seed, tile).ok_or("fractalNoise failed")?;
    Ok(put(s))
}

pub fn shader_turbulence(fx: f32, fy: f32, octaves: u32, seed: f32, tile_w: i32, tile_h: i32) -> R<u32> {
    let tile = if tile_w > 0 && tile_h > 0 { Some(ISize::new(tile_w, tile_h)) } else { None };
    let s = perlin_noise_shader::turbulence((fx, fy), octaves as usize, seed, tile).ok_or("turbulence failed")?;
    Ok(put(s))
}

pub fn shader_with_local_matrix(h: u32, m: &[f32]) -> R<u32> {
    let s = cloned::<Shader>(h)?;
    let m = crate::convert::matrix(m)?;
    Ok(put(s.with_local_matrix(&m)))
}

pub fn shader_with_color_filter(h: u32, cf: u32) -> R<u32> {
    let s = cloned::<Shader>(h)?;
    let f = cloned::<ColorFilter>(cf)?;
    Ok(put(s.with_color_filter(f)))
}

// ---- runtime effects (SkSL) ----

/// kind: 0 shader, 1 color filter, 2 blender.
pub fn runtime_effect_make(kind: u32, sksl: &str) -> R<u32> {
    let e = match kind {
        1 => RuntimeEffect::make_for_color_filter(sksl, None),
        2 => RuntimeEffect::make_for_blender(sksl, None),
        _ => RuntimeEffect::make_for_shader(sksl, None),
    }?;
    Ok(put(e))
}

/// JSON: `[{"name","offset","size","count","type"}]` where type is the SkSL type name.
pub fn runtime_effect_uniforms(h: u32) -> R<String> {
    let e = get::<RuntimeEffect>(h)?;
    let e = e.borrow();
    let items: Vec<String> = e
        .uniforms()
        .iter()
        .map(|u| {
            format!(
                "{{\"name\":{},\"offset\":{},\"size\":{},\"count\":{},\"type\":\"{:?}\",\"array\":{}}}",
                json_str(u.name()),
                u.offset(),
                u.size_in_bytes(),
                u.count(),
                u.ty(),
                u.is_array()
            )
        })
        .collect();
    Ok(format!("[{}]", items.join(",")))
}

/// JSON: `[{"name","index","type"}]` with type "Shader" | "ColorFilter" | "Blender".
pub fn runtime_effect_children(h: u32) -> R<String> {
    let e = get::<RuntimeEffect>(h)?;
    let e = e.borrow();
    let items: Vec<String> = e
        .children()
        .iter()
        .map(|c| format!("{{\"name\":{},\"index\":{},\"type\":\"{:?}\"}}", json_str(c.name()), c.index(), c.ty()))
        .collect();
    Ok(format!("[{}]", items.join(",")))
}

pub fn runtime_effect_uniform_size(h: u32) -> R<u32> {
    Ok(get::<RuntimeEffect>(h)?.borrow().uniform_size() as u32)
}

fn child_ptrs(e: &RuntimeEffect, children: &[u32]) -> R<Vec<skia_safe::runtime_effect::ChildPtr>> {
    use skia_safe::runtime_effect::ChildPtr;
    let specs = e.children();
    let mut out = Vec::with_capacity(children.len());
    for (i, h) in children.iter().enumerate() {
        let ty = specs.get(i).map(|c| format!("{:?}", c.ty())).unwrap_or_default();
        if *h == 0 {
            return Err(format!("child {i} is missing"));
        }
        out.push(match ty.as_str() {
            "ColorFilter" => ChildPtr::from(cloned::<ColorFilter>(*h)?),
            "Blender" => ChildPtr::from(cloned::<Blender>(*h)?),
            _ => ChildPtr::from(cloned::<Shader>(*h)?),
        });
    }
    Ok(out)
}

pub fn runtime_effect_make_shader(h: u32, uniforms: &[u8], children: &[u32], m: &[f32]) -> R<u32> {
    let e = cloned::<RuntimeEffect>(h)?;
    let kids = child_ptrs(&e, children)?;
    let m = matrix_opt(m)?;
    let s = e
        .make_shader(Data::new_copy(uniforms), &kids, m.as_ref())
        .ok_or("makeShader failed (uniform size or children mismatch?)")?;
    Ok(put(s))
}

pub fn runtime_effect_make_color_filter(h: u32, uniforms: &[u8], children: &[u32]) -> R<u32> {
    let e = cloned::<RuntimeEffect>(h)?;
    let kids = child_ptrs(&e, children)?;
    let f = e.make_color_filter(Data::new_copy(uniforms), Some(kids.as_slice())).ok_or("makeColorFilter failed")?;
    Ok(put(f))
}

pub fn runtime_effect_make_blender(h: u32, uniforms: &[u8], children: &[u32]) -> R<u32> {
    let e = cloned::<RuntimeEffect>(h)?;
    let kids = child_ptrs(&e, children)?;
    let b = e.make_blender(Data::new_copy(uniforms), Some(kids.as_slice())).ok_or("makeBlender failed")?;
    Ok(put(b))
}

pub(crate) fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
