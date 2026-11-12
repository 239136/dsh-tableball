param([ValidateSet('b','t','m','r','q')][string]$Key)
$shell = New-Object -ComObject WScript.Shell
$shell.SendKeys('^%' + $Key)
