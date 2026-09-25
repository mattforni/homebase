-- The Dock icon for Brave. setup.sh compiles this into ~/Applications/Brave.app
-- wearing Brave's own icon, so a click from the Dock opens Brave with the CDP
-- port on 9222 instead of launching it bare through LaunchServices.
--
-- Brave already running: bring it forward, whatever it was launched with.
-- Brave not running: start it through the login agent, so launchd supervises
-- it and brings it back with the port after a crash. If the agent is not
-- loaded (booted out on purpose to close the port), open Brave normally.

if (do shell script "pgrep -xq -u $(id -u) 'Brave Browser' && echo yes || echo no") is "yes" then
	do shell script "open -a 'Brave Browser'"
else
	try
		do shell script "launchctl kickstart -k gui/$(id -u)/me.atelic.brave-debug-port"
	on error
		do shell script "open -a 'Brave Browser'"
	end try
end if
