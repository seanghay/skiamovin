use skiamovin_codecs::*;

#[test]
fn capabilities_smoke() {
    let caps = capabilities();
    println!("{caps:?}");
    if cfg!(target_os = "macos") {
        assert!(caps.video_encode.iter().any(|(c, _)| *c == VideoCodec::Avc));
        assert!(caps.video_decode.iter().any(|(c, _)| *c == VideoCodec::Avc));
        assert!(caps.video_decode.iter().any(|(c, _)| *c == VideoCodec::Hevc));
        assert_eq!(caps.audio_encode, vec![AudioCodec::Aac]);
        assert!(caps.audio_decode.contains(&AudioCodec::Aac));
        assert!(caps.audio_decode.contains(&AudioCodec::Mp3));
    } else {
        assert!(caps.video_encode.is_empty());
        assert!(VideoEncoder::new(VideoEncoderConfig::new(VideoCodec::Avc, 64, 64)).is_err());
    }
}

#[test]
fn types_are_send() {
    fn assert_send<T: Send>() {}
    assert_send::<VideoEncoder>();
    assert_send::<VideoDecoder>();
    assert_send::<AudioEncoder>();
    assert_send::<AudioDecoder>();
}
