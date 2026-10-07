param(
    [Parameter(Mandatory=$true)][string]$Application,
    [Parameter(Mandatory=$true)][string]$Installer,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{40}$')][string]$ExpectedThumbprint
)
$ErrorActionPreference = 'Stop'
foreach ($file in @($Application, $Installer)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing signed artifact: $file" }
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {
        throw "Invalid Authenticode signature on $file : $($signature.Status)"
    }
    if ($signature.SignerCertificate.Thumbprint -ine $ExpectedThumbprint) {
        throw "Unexpected signing certificate on $file"
    }
    if ($null -eq $signature.TimeStamperCertificate) {
        throw "Missing trusted signature timestamp on $file"
    }
    Write-Output "Verified Authenticode signature and timestamp: $file"
}
