$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$repository = 'DevDoukan/quartz-notebook-7f3c'
$report = Get-Content -LiteralPath (Join-Path $root 'release/RELEASE-STATUS.json') -Raw | ConvertFrom-Json
if (!$report.reportComplete -or !$report.releaseTestsPassed -or $report.version -notmatch '^\d+\.\d+\.\d+(?:-rc\.\d+)?$') {
    throw 'Doğrulanmış yayın raporu gerekli.'
}

$installers = @{}
foreach ($role in 'client', 'server') {
    $package = @($report.packages | Where-Object { $_.role -eq $role -and $_.version -eq $report.version })
    if ($package.Count -ne 1) { throw "Kurulum paketi eksik veya yinelenmiş ($role)." }
    $file = Get-Item -LiteralPath (Join-Path (Join-Path $root 'release') ([IO.Path]::GetFileName($package[0].path)))
    if ($file.Extension -ne '.exe' -or $file.Length -ne $package[0].bytes -or
        (Get-FileHash -LiteralPath $file.FullName).Hash -ine $package[0].sha256) {
        throw "Kurulum paketi yayın raporuyla eşleşmiyor ($role)."
    }
    $installers[$role] = @{ file = $file; sha256 = $package[0].sha256 }
}

# Reuse the authenticated Git account without printing its credential.
$auth = "protocol=https`nhost=github.com`n`n" | git -C $root credential fill
$secret = $auth | Where-Object { $_ -like 'password=*' } | Select-Object -First 1
if (!$secret) { throw 'GitHub için Git kimlik doğrulaması gerekli.' }
$headers = @{ Authorization = 'Bearer ' + $secret.Substring(9); Accept = 'application/vnd.github+json' }
$api = "https://api.github.com/repos/$repository"
$tag = 'v' + $report.version
$preview = !$report.readyForSale -or $tag.Contains('-rc.')
$note = if ($preview) { 'Windows test sürümü. Kurucular test ortamında kullanım içindir.' } else { 'Windows Client ve Server kurucuları.' }
$release = Invoke-RestMethod "$api/releases/tags/$tag" -Headers $headers -SkipHttpErrorCheck -StatusCodeVariable releaseStatus
if ($releaseStatus -eq 404) {
    $release = @(Invoke-RestMethod "$api/releases" -Headers $headers) |
        Where-Object { $_.tag_name -eq $tag } | Select-Object -First 1
    if (!$release) {
        $release = Invoke-RestMethod "$api/releases" -Method Post -Headers $headers -ContentType 'application/json' -Body (
            @{ tag_name = $tag; name = $tag; draft = $true; prerelease = $preview; body = $note } | ConvertTo-Json
        )
    }
} elseif ($releaseStatus -ne 200) {
    throw "GitHub yayın sorgusu başarısız ($releaseStatus)."
}

$links = @{}
foreach ($role in 'client', 'server') {
    $installer = $installers[$role]
    $file = $installer.file
    $asset = $release.assets | Where-Object name -eq $file.Name | Select-Object -First 1
    if (!$asset) {
        $uploadUrl = $release.upload_url -replace '\{.*$', ''
        if ($uploadUrl -notlike "https://uploads.github.com/repos/$repository/releases/*") { throw 'Yükleme adresi geçersiz.' }
        $asset = Invoke-RestMethod ($uploadUrl + '?name=' + [uri]::EscapeDataString($file.Name)) -Method Post -Headers $headers -ContentType 'application/octet-stream' -InFile $file.FullName
    }
    if ($asset.size -ne $file.Length -or $asset.digest -ine ('sha256:' + $installer.sha256)) {
        throw "GitHub dosyası yayın raporuyla eşleşmiyor ($role)."
    }
    $links[$role] = $asset.browser_download_url
}
if ($release.draft) {
    Invoke-RestMethod "$api/releases/$($release.id)" -Method Patch -Headers $headers -ContentType 'application/json' -Body (
        @{ draft = $false; make_latest = 'false' } | ConvertTo-Json
    ) | Out-Null
}

$folder = Join-Path $root 'latest'
New-Item -ItemType Directory -Path $folder -Force | Out-Null
@"
# Güncel Windows kurucuları

**$($report.version)** · $note

| İndir | Nereye kurulur? |
| --- | --- |
| [Client kurucusu]($($links.client)) | Korunacak Windows bilgisayarına |
| [Server kurucusu]($($links.server)) | Şirketin Windows merkez sunucusuna |

[Kurulum kılavuzu](../KURULUM-README.md)
"@ | Set-Content -LiteralPath (Join-Path $folder 'README.md') -Encoding utf8
Write-Host 'latest hazır. README değişikliğini commit edip GitHub deposuna gönderin.'
