param([Parameter(Mandatory)] [long] $WindowHandle)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WorkbenchMenuKeys {
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint msg, IntPtr wParam, IntPtr lParam);
}
"@
$window = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$WindowHandle)
$condition = [Windows.Automation.PropertyCondition]::new(
    [Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::MenuItem)
function Read-MenuItems {
    $window.FindAll([Windows.Automation.TreeScope]::Descendants, $condition) |
        Where-Object { !$_.Current.IsOffscreen } | ForEach-Object { $_.Current.Name }
}
$deadline = [DateTime]::UtcNow.AddSeconds(4)
$names = @(Read-MenuItems)
while (!$names.Count) {
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Windows UI Automation did not find the native menu' }
    Start-Sleep -Milliseconds 30
    $names = @(Read-MenuItems)
}
ConvertTo-Json -Compress -InputObject $names
# Deliver Escape to this window only, then wait for the native menu to disappear.
[void][WorkbenchMenuKeys]::PostMessage([IntPtr]$WindowHandle, 0x100, 0x1B, 0x10001)
[void][WorkbenchMenuKeys]::PostMessage([IntPtr]$WindowHandle, 0x101, 0x1B, -1073676287)
$deadline = [DateTime]::UtcNow.AddSeconds(4)
while (@(Read-MenuItems).Count) {
    if ([DateTime]::UtcNow -ge $deadline) { throw 'The native menu stayed open after Escape' }
    Start-Sleep -Milliseconds 30
}
