//! Object lifetime, diagnostics and PDF documents.

use crate::api::canvas::CanvasRef;
use crate::handles::{get, put, remove};
use crate::R;
use skia_safe::{pdf, Canvas};

/// Releases any object. Deleting an already-deleted handle is a no-op.
pub fn object_delete(h: u32) {
    remove(h);
}

pub fn object_exists(h: u32) -> bool {
    crate::handles::exists(h)
}

/// Number of live objects on this thread (for leak checks).
pub fn object_count() -> u32 {
    crate::handles::count()
}

pub fn skia_version() -> String {
    format!("skia-safe {} / Skia m{}", env!("SKIA_SAFE_VERSION"), skia_safe::MILESTONE)
}

// ---- PDF ----

pub struct PdfObj {
    // The document borrows its output buffer, so both are kept alive together.
    doc: Option<PdfState>,
    pub canvas_handle: u32,
    // Boxed so the document's pointer to it stays valid when PdfObj moves.
    #[allow(clippy::box_collection)]
    out: Box<Vec<u8>>,
    _meta: Box<pdf::Metadata<'static>>,
}

enum PdfState {
    Open(skia_safe::Document<'static, skia_safe::document::state::Open>),
    OnPage(skia_safe::Document<'static, skia_safe::document::state::OnPage>),
}

impl Drop for PdfObj {
    fn drop(&mut self) {
        self.doc = None;
        if self.canvas_handle != 0 {
            remove(self.canvas_handle);
        }
    }
}

pub fn pdf_document_new(title: &str, author: &str) -> R<u32> {
    let mut out: Box<Vec<u8>> = Box::default();
    // SAFETY: the Vec lives in a Box owned by the same PdfObj and outlives the document (dropped first in Drop).
    let out_ref: &'static mut Vec<u8> = unsafe { &mut *(out.as_mut() as *mut Vec<u8>) };
    let meta = Box::new(pdf::Metadata { title: title.to_string(), author: author.to_string(), ..Default::default() });
    // SAFETY: as above, the metadata box lives as long as the document.
    let meta_ref: &'static pdf::Metadata<'static> = unsafe { &*(meta.as_ref() as *const pdf::Metadata<'static>) };
    let doc = pdf::new_document(out_ref, Some(meta_ref));
    let h = put(PdfObj { doc: Some(PdfState::Open(doc)), canvas_handle: 0, out, _meta: meta });
    let c = put(CanvasRef::PdfPage(h));
    get::<PdfObj>(h)?.borrow_mut().canvas_handle = c;
    Ok(h)
}

/// Starts a page and returns the document's canvas handle.
pub fn pdf_document_begin_page(h: u32, width: f32, height: f32) -> R<u32> {
    let d = get::<PdfObj>(h)?;
    let mut d = d.borrow_mut();
    let doc = match d.doc.take() {
        Some(PdfState::Open(doc)) => doc,
        Some(PdfState::OnPage(p)) => p.end_page(),
        None => return Err("document is closed".into()),
    };
    d.doc = Some(PdfState::OnPage(doc.begin_page((width, height), None)));
    Ok(d.canvas_handle)
}

pub fn pdf_document_end_page(h: u32) -> R<()> {
    let d = get::<PdfObj>(h)?;
    let mut d = d.borrow_mut();
    d.doc = match d.doc.take() {
        Some(PdfState::OnPage(p)) => Some(PdfState::Open(p.end_page())),
        other => other,
    };
    Ok(())
}

/// Finishes the document and returns the PDF bytes.
pub fn pdf_document_close(h: u32) -> R<Vec<u8>> {
    let d = get::<PdfObj>(h)?;
    let mut d = d.borrow_mut();
    match d.doc.take() {
        Some(PdfState::Open(doc)) => doc.close(),
        Some(PdfState::OnPage(p)) => p.end_page().close(),
        None => return Err("document already closed".into()),
    }
    Ok(std::mem::take(d.out.as_mut()))
}

pub(crate) fn with_pdf_canvas<T>(h: u32, f: impl FnOnce(&Canvas) -> T) -> R<T> {
    let d = get::<PdfObj>(h)?;
    let mut d = d.borrow_mut();
    match d.doc.as_mut() {
        Some(PdfState::OnPage(p)) => Ok(f(p.canvas())),
        _ => Err("PDF document has no open page; call beginPage first".into()),
    }
}
