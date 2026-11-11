//! 2D rigid body physics with Rapier, simulated once at a fixed step and stored, so any moment can be looked up.
//! Rapier runs in its deterministic mode, and bodies are added in a fixed order, so results match across builds.

use crate::handles::{get, put};
use crate::R;
use rapier2d::prelude::*;
use serde_json::Value;

pub struct SimObj {
    hz: f32,
    steps: u32,
    bodies: u32,
    /// Per step, per body: x, y, angle (radians).
    frames: Vec<f32>,
    /// Per contact change: step, body a, body b, 1 for started or 0 for ended.
    contacts: Vec<u32>,
}

fn num(v: &Value, key: &str, default: f32) -> f32 {
    v.get(key).and_then(Value::as_f64).map(|x| x as f32).unwrap_or(default)
}

fn vec2(v: &Value, key: &str) -> Option<Vector> {
    let a = v.get(key)?.as_array()?;
    Some(Vector::new(a.first()?.as_f64()? as f32, a.get(1)?.as_f64()? as f32))
}

fn shape(body: &Value) -> R<ColliderBuilder> {
    let s = body.get("shape").ok_or("physics: body without a shape")?;
    let kind = s.get("kind").and_then(Value::as_str).unwrap_or("box");
    Ok(match kind {
        "circle" => ColliderBuilder::ball(num(s, "radius", 10.0)),
        "box" => {
            let r = num(s, "radius", 0.0);
            let (hw, hh) = (num(s, "width", 20.0) / 2.0, num(s, "height", 20.0) / 2.0);
            if r > 0.0 {
                ColliderBuilder::round_cuboid((hw - r).max(0.01), (hh - r).max(0.01), r)
            } else {
                ColliderBuilder::cuboid(hw, hh)
            }
        }
        "capsule" => ColliderBuilder::capsule_y(num(s, "height", 20.0) / 2.0, num(s, "radius", 10.0)),
        "polygon" => {
            let pts: Vec<Vector> = s
                .get("points")
                .and_then(Value::as_array)
                .ok_or("physics: polygon without points")?
                .chunks(2)
                .filter_map(|c| Some(Vector::new(c.first()?.as_f64()? as f32, c.get(1)?.as_f64()? as f32)))
                .collect();
            ColliderBuilder::convex_hull(&pts).ok_or("physics: polygon points don't form a convex shape")?
        }
        "segment" => {
            let a = vec2(s, "a").ok_or("physics: segment without a")?;
            let b = vec2(s, "b").ok_or("physics: segment without b")?;
            ColliderBuilder::segment(a, b)
        }
        other => return Err(format!("physics: unknown shape '{other}'")),
    })
}

/// Simulates a world described as JSON and returns a handle to the stored result. See the TypeScript `physics()`.
pub fn physics_simulate(def: &str) -> R<u32> {
    let def: Value = serde_json::from_str(def).map_err(|e| format!("physics: invalid description: {e}"))?;
    let hz = num(&def, "hz", 120.0).clamp(10.0, 1000.0);
    let duration = num(&def, "duration", 5.0).clamp(0.0, 600.0);
    let steps = (duration * hz).ceil() as u32;
    let mut world = PhysicsWorld::new();
    world.gravity = vec2(&def, "gravity").unwrap_or(Vector::new(0.0, 980.0));
    world.integration_parameters.dt = 1.0 / hz;
    // Lengths are in pixels; tell Rapier so its tolerances suit that scale.
    world.integration_parameters.length_unit = num(&def, "lengthUnit", 100.0);

    let empty = vec![];
    let bodies = def.get("bodies").and_then(Value::as_array).unwrap_or(&empty);
    let mut handles = Vec::with_capacity(bodies.len());
    for (i, b) in bodies.iter().enumerate() {
        let kind = b.get("type").and_then(Value::as_str).unwrap_or("dynamic");
        let builder = match kind {
            "fixed" | "static" => RigidBodyBuilder::fixed(),
            "kinematic" => RigidBodyBuilder::kinematic_velocity_based(),
            _ => RigidBodyBuilder::dynamic(),
        };
        let body = builder
            .translation(Vector::new(num(b, "x", 0.0), num(b, "y", 0.0)))
            .rotation(num(b, "angle", 0.0).to_radians())
            .linvel(vec2(b, "velocity").unwrap_or(Vector::ZERO))
            .angvel(num(b, "angularVelocity", 0.0).to_radians())
            .linear_damping(num(b, "linearDamping", 0.0))
            .angular_damping(num(b, "angularDamping", 0.0))
            .ccd_enabled(b.get("ccd").and_then(Value::as_bool).unwrap_or(false));
        let collider = shape(b)?
            .restitution(num(b, "restitution", 0.2))
            .friction(num(b, "friction", 0.5))
            .density(num(b, "density", 1.0))
            .sensor(b.get("sensor").and_then(Value::as_bool).unwrap_or(false))
            .user_data(i as u128);
        let (h, _) = world.insert(body, collider);
        handles.push(h);
    }

    for j in def.get("joints").and_then(Value::as_array).unwrap_or(&empty) {
        let idx = |k: &str| -> R<RigidBodyHandle> {
            let i = j.get(k).and_then(Value::as_u64).ok_or(format!("physics: joint without '{k}'"))? as usize;
            handles.get(i).copied().ok_or(format!("physics: joint body {i} doesn't exist"))
        };
        let (a, b) = (idx("a")?, idx("b")?);
        let aa = vec2(j, "anchorA").unwrap_or(Vector::ZERO);
        let ab = vec2(j, "anchorB").unwrap_or(Vector::ZERO);
        let joint: GenericJoint = match j.get("kind").and_then(Value::as_str).unwrap_or("revolute") {
            "fixed" => FixedJointBuilder::new().local_anchor1(aa).local_anchor2(ab).into(),
            "rope" => RopeJointBuilder::new(num(j, "length", 100.0)).local_anchor1(aa).local_anchor2(ab).into(),
            "spring" => {
                SpringJointBuilder::new(num(j, "length", 100.0), num(j, "stiffness", 50.0), num(j, "damping", 2.0))
                    .local_anchor1(aa)
                    .local_anchor2(ab)
                    .into()
            }
            "prismatic" => {
                let axis = vec2(j, "axis").unwrap_or(Vector::X).normalize_or(Vector::X);
                PrismaticJointBuilder::new(axis).local_anchor1(aa).local_anchor2(ab).into()
            }
            _ => RevoluteJointBuilder::new().local_anchor1(aa).local_anchor2(ab).into(),
        };
        world.insert_impulse_joint(a, b, joint);
    }

    let n = handles.len();
    let mut frames = Vec::with_capacity((steps as usize + 1) * n * 3);
    let record = |world: &PhysicsWorld, frames: &mut Vec<f32>| {
        for h in &handles {
            let body = &world.bodies[*h];
            let t = body.translation();
            frames.extend_from_slice(&[t.x, t.y, body.rotation().angle()]);
        }
    };
    record(&world, &mut frames);
    let mut contacts = vec![];
    let mut touching = std::collections::BTreeSet::<(u32, u32)>::new();
    for step in 1..=steps {
        world.step();
        record(&world, &mut frames);
        let mut now = std::collections::BTreeSet::new();
        for pair in world.contact_pairs() {
            if !pair.has_any_active_contact() {
                continue;
            }
            let (Some(c1), Some(c2)) = (world.colliders.get(pair.collider1), world.colliders.get(pair.collider2))
            else {
                continue;
            };
            let (x, y) = (c1.user_data as u32, c2.user_data as u32);
            now.insert((x.min(y), x.max(y)));
        }
        for p in now.difference(&touching) {
            contacts.extend_from_slice(&[step, p.0, p.1, 1]);
        }
        for p in touching.difference(&now) {
            contacts.extend_from_slice(&[step, p.0, p.1, 0]);
        }
        touching = now;
    }
    Ok(put(SimObj { hz, steps, bodies: n as u32, frames, contacts }))
}

/// `[steps per second, steps, bodies]`.
pub fn physics_info(h: u32) -> R<Vec<f32>> {
    let s = get::<SimObj>(h)?;
    let s = s.borrow();
    Ok(vec![s.hz, s.steps as f32, s.bodies as f32])
}

/// Every stored step: per body x, y, angle (radians).
pub fn physics_frames(h: u32) -> R<Vec<f32>> {
    Ok(get::<SimObj>(h)?.borrow().frames.clone())
}

/// Contact changes: per entry step, body a, body b, and 1 when they started touching or 0 when they stopped.
pub fn physics_contacts(h: u32) -> R<Vec<u32>> {
    Ok(get::<SimObj>(h)?.borrow().contacts.clone())
}
