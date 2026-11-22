$ErrorActionPreference = 'Stop'

Push-Location (Join-Path $PSScriptRoot '../../..')
try {
    $profilePath = if ($env:AI_ASK_E2E_PROFILE) { $env:AI_ASK_E2E_PROFILE } else { 'test-results/windows-profile' }
    if ((Split-Path -Leaf $profilePath) -ne 'windows-profile') {
        throw 'The isolated E2E profile directory must be named windows-profile'
    }
    $profile = New-Item -ItemType Directory -Path $profilePath -Force
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

    pnpm --filter ai-ask-contract build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    pnpm --filter ai-ask-serv build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $manifest = 'apps/ai-ask-desktop/src-tauri/Cargo.toml'
    cargo build --locked --manifest-path $manifest
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $metadata = cargo metadata --format-version 1 --no-deps --manifest-path $manifest | ConvertFrom-Json
    # Cargo integration tests can rebuild the ordinary bin target; keep this isolated executable stable.
    $binaryDirectory = New-Item -ItemType Directory -Path (Join-Path $profile.Parent.FullName 'windows-bin') -Force
    $env:AI_ASK_E2E_EXE = Join-Path $binaryDirectory.FullName 'ai-ask.exe'
    Copy-Item -LiteralPath (Join-Path $metadata.target_directory 'debug/ai-ask.exe') -Destination $env:AI_ASK_E2E_EXE -Force
    pnpm --filter ai-ask-desktop test:e2e @args
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
