//! 使用隔离临时密钥验证官方插件；不读取或生成产品发布密钥。
use std::time::Duration;
use tauri_plugin_updater::UpdaterExt;

#[tokio::test]
async fn official_plugin_downloads_and_verifies_a_real_signed_fixture_and_rejects_tampering() {
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};
    use tauri::test::{mock_builder, mock_context, noop_assets};

    let directory = tempfile::tempdir().unwrap();
    let key = directory.path().join("fixture.key");
    let artifact = directory.path().join("fixture.bin");
    let located = Command::new("node")
        .args([
            "-e",
            "process.stdout.write(require.resolve('@tauri-apps/cli/tauri.js'))",
        ])
        .current_dir(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap(),
        )
        .output()
        .unwrap();
    assert!(
        located.status.success(),
        "Resolve the installed Tauri CLI for the isolated fixture"
    );
    let cli = std::path::PathBuf::from(String::from_utf8(located.stdout).unwrap());
    let run = |args: &[&std::ffi::OsStr]| {
        let result = Command::new("node")
            .arg(&cli)
            .args(args)
            .env_remove("TAURI_SIGNING_PRIVATE_KEY")
            .env_remove("TAURI_SIGNING_PRIVATE_KEY_PASSWORD")
            .env_remove("TAURI_SIGNING_PRIVATE_KEY_PATH")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert!(
            result.success(),
            "Tauri test-fixture signer failed: {result}"
        );
    };
    run(&[
        "signer".as_ref(),
        "generate".as_ref(),
        "--ci".as_ref(),
        "-w".as_ref(),
        key.as_os_str(),
    ]);
    let bytes = b"Hai updater isolated signature verification fixture".to_vec();
    std::fs::write(&artifact, &bytes).unwrap();
    run(&[
        "signer".as_ref(),
        "sign".as_ref(),
        "-f".as_ref(),
        key.as_os_str(),
        "--app-version".as_ref(),
        "9999.0.0".as_ref(),
        artifact.as_os_str(),
    ]);
    let public_key = std::fs::read_to_string(key.with_extension("key.pub")).unwrap();
    let signature = std::fs::read_to_string(artifact.with_extension("bin.sig")).unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let manifest = serde_json::to_vec(&serde_json::json!({"version":"9999.0.0","platforms":{"fixture":{"url":format!("{endpoint}/fixture.bin"),"signature":signature.trim()}}})).unwrap();
    let valid = bytes.clone();
    let server = std::thread::spawn(move || {
        for body in [manifest, valid.clone(), vec![b'X'; valid.len()]] {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(&body).unwrap();
        }
    });
    let mut context = mock_context(noop_assets());
    context.config_mut().plugins.0.insert("updater".into(), serde_json::json!({"endpoints":[format!("{endpoint}/latest.json")],"pubkey":public_key.trim(),"requireSignedVersion":true,"dangerousInsecureTransportProtocol":true}));
    let app = mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let update = app
        .updater_builder()
        .target("fixture")
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap()
        .check()
        .await
        .unwrap()
        .unwrap();
    assert_eq!(update.download(|_, _| {}, || {}).await.unwrap(), bytes);
    assert!(
        update.download(|_, _| {}, || {}).await.is_err(),
        "Corrupted bytes must fail the official verifier"
    );
    let mut wrong_version = update.clone();
    wrong_version.version = "9999.0.1".into();
    assert!(
        wrong_version.verify(&bytes).is_err(),
        "A valid signature cannot authorize a different announced version"
    );
    server.join().unwrap();
}
