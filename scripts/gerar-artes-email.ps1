# Gera os PNGs das artes dos e-mails a partir de design/emails/arte.html, usando o Edge em modo headless.
# Saída em 2x (1200x600) para ficar nítido em telas de alta densidade; no e-mail a imagem é exibida com 600 px.
$raiz = Split-Path $PSScriptRoot -Parent
$edge = @('C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', 'C:\Program Files\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge não encontrado.' }
$fonte = ([Uri](Join-Path $raiz 'design\emails\arte.html')).AbsoluteUri
$destino = Join-Path $raiz 'public\emails'
New-Item -ItemType Directory -Force $destino | Out-Null
$perfil = Join-Path $env:TEMP 'finvision-edge-render'

Add-Type -AssemblyName System.Drawing
$jpeg = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$qualidade = New-Object Drawing.Imaging.EncoderParameters 1
$qualidade.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), 88L

foreach ($item in @(@{ v = 'confirmar'; arquivo = 'primeiro-acesso' }, @{ v = 'senha'; arquivo = 'nova-senha' })) {
  $png = Join-Path $env:TEMP "$($item.arquivo).png"
  $saida = Join-Path $destino "$($item.arquivo).jpg"
  & $edge --headless=new --disable-gpu --hide-scrollbars --no-first-run "--user-data-dir=$perfil" `
    --force-device-scale-factor=2 --window-size=600,300 --default-background-color=ffffffff `
    "--screenshot=$png" "$fonte#$($item.v)" 2>$null | Out-Null
  if (-not (Test-Path $png)) { "FALHOU: $($item.arquivo)"; continue }
  # JPEG: e-mail pesado demora a abrir e conta contra o filtro de spam.
  $img = [Drawing.Image]::FromFile($png)
  $img.Save($saida, $jpeg, $qualidade)
  $img.Dispose()
  Remove-Item $png
  "gerado: public/emails/$($item.arquivo).jpg ($([math]::Round((Get-Item $saida).Length / 1KB)) KB)"
}
