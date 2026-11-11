//! Functions that need JavaScript callbacks. The generator skips them, and each binding crate wraps them by hand.

use crate::api::taffy::compute_layout_impl;
use crate::{MeasureCallback, R};

/// Computes layout; leaves with JS contexts are measured through `measure`.
pub fn taffy_compute_layout_with_measure(
    tree: u32,
    node: u32,
    avail_w: f32,
    avail_h: f32,
    measure: &mut MeasureCallback,
) -> R<()> {
    compute_layout_impl(tree, node, avail_w, avail_h, Some(measure))
}
