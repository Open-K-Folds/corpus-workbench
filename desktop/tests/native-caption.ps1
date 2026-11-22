param(
    [Parameter(Mandatory)] [long] $WindowHandle,
    [Parameter(Mandatory)] [ValidateSet('Minimize', 'Maximize', 'Restore', 'Close')] [string] $Button
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
$window = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$WindowHandle)
$condition = [Windows.Automation.PropertyCondition]::new(
    [Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button)
$controls = $window.FindAll([Windows.Automation.TreeScope]::Descendants, $condition)
$caption = $controls | Where-Object { $_.Current.Name -eq $Button -and !$_.Current.IsOffscreen } | Select-Object -First 1
if (!$caption) { throw "Windows UI Automation could not find the visible $Button button" }
$caption.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
