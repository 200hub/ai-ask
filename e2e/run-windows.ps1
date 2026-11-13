$ErrorActionPreference = 'Stop'

Push-Location (Join-Path $PSScriptRoot '..')
try {
    $profile = New-Item -ItemType Directory -Path 'test-results/windows-profile' -Force
    $config = @{
        identifier = 'com.200hub.aiask.e2e'
        app = @{ appDirectoriesOverride = $profile.FullName }
    } | ConvertTo-Json -Compress

    $env:TAURI_CONFIG = $config
    $env:CARGO_PROFILE_DEV_OPT_LEVEL = '0'
    $env:CARGO_PROFILE_DEV_DEBUG = '0'
    $env:CARGO_PROFILE_DEV_BUILD_OVERRIDE_OPT_LEVEL = '0'
    $env:AI_ASK_E2E_DATA = $profile.FullName
    $env:NO_PROXY = (@($env:NO_PROXY, 'localhost', '127.0.0.1') | Where-Object { $_ }) -join ','

    cargo build --locked --manifest-path src-tauri/Cargo.toml
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $metadata = cargo metadata --format-version 1 --no-deps --manifest-path src-tauri/Cargo.toml | ConvertFrom-Json
    $env:AI_ASK_E2E_EXE = Join-Path $metadata.target_directory 'debug/ai-ask.exe'
    pnpm test:e2e @args
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
