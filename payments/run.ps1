param([ValidateSet('check','pay')][string]$Mode = 'check')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$paymentNode = Get-Command node -ErrorAction SilentlyContinue
if ($paymentNode) {
    $paymentNodePath = $paymentNode.Source
} else {
    $paymentNodePath = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
}
if (-not (Test-Path -LiteralPath $paymentNodePath)) { throw 'Install Node.js 22.13 or later, then retry.' }
if ($Mode -eq 'check') {
    & $paymentNodePath --env-file-if-exists=.env preflight.cjs
} else {
    & $paymentNodePath --env-file=.env ap4m-agent.cjs --pay
}
exit $LASTEXITCODE
