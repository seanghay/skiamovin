use crate::api::canvas::CanvasRef;
use crate::handles::{get, put, remove};
use crate::R;
use skia_safe::{Data, Picture, PictureRecorder, Rect};

pub struct RecorderObj {
    pub recorder: PictureRecorder,
    pub canvas_handle: u32,
}

impl Drop for RecorderObj {
    fn drop(&mut self) {
        if self.canvas_handle != 0 {
            remove(self.canvas_handle);
        }
    }
}

pub fn picture_recorder_new() -> u32 {
    put(RecorderObj { recorder: PictureRecorder::new(), canvas_handle: 0 })
}

/// Starts recording; returns the recording canvas handle (valid until finished).
pub fn picture_recorder_begin(h: u32, l: f32, t: f32, r: f32, b: f32) -> R<u32> {
    let rec = get::<RecorderObj>(h)?;
    let mut rec = rec.borrow_mut();
    rec.recorder.begin_recording(Rect::new(l, t, r, b), false);
    if rec.canvas_handle == 0 {
        rec.canvas_handle = put(CanvasRef::Recorder(h));
    }
    Ok(rec.canvas_handle)
}

pub fn picture_recorder_finish(h: u32) -> R<u32> {
    let rec = get::<RecorderObj>(h)?;
    let mut rec = rec.borrow_mut();
    let pic = rec.recorder.finish_recording_as_picture(None).ok_or("nothing was recorded")?;
    Ok(put(pic))
}

pub fn picture_serialize(h: u32) -> R<Vec<u8>> {
    Ok(get::<Picture>(h)?.borrow().serialize().as_bytes().to_vec())
}

pub fn picture_from_data(bytes: &[u8]) -> R<u32> {
    let p = Picture::from_data(&Data::new_copy(bytes)).ok_or("invalid picture data")?;
    Ok(put(p))
}

pub fn picture_cull_rect(h: u32) -> R<Vec<f32>> {
    let r = get::<Picture>(h)?.borrow().cull_rect();
    Ok(vec![r.left, r.top, r.right, r.bottom])
}

pub fn picture_approximate_op_count(h: u32) -> R<u32> {
    Ok(get::<Picture>(h)?.borrow().approximate_op_count() as u32)
}
