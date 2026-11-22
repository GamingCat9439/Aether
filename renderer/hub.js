/* Bundled utilities for the script hub. Every entry is plain Lua and runs
   through the connected executor. Keep scripts self-contained. */

window.HUB_SCRIPTS = [
  {
    id: 'anti-afk',
    title: 'Anti-AFK',
    blurb: 'Keeps your session alive through idle kicks by nudging the client when Roblox reports inactivity.',
    category: 'utility',
    tags: ['Utility', 'Session'],
    code: `-- Aether hub · Anti-AFK
-- Keeps the session alive during idle periods.

local Players = game:GetService("Players")
local VirtualUser = game:GetService("VirtualUser")

local player = Players.LocalPlayer

player.Idled:Connect(function()
    VirtualUser:CaptureController()
    VirtualUser:ClickButton2(Vector2.new())
end)

print("Anti-AFK armed")`,
  },
  {
    id: 'fps-cap',
    title: 'FPS cap',
    blurb: 'Raises the frame cap to 240 using the executor FPS API, with a clear warning when it is not exposed.',
    category: 'performance',
    tags: ['Performance', 'Client'],
    code: `-- Aether hub · FPS cap
-- Uses the executor's setfpscap when available.

local cap = 240

if type(setfpscap) == "function" then
    setfpscap(cap)
    print("FPS cap set to " .. cap)
else
    warn("setfpscap is not available in this executor")
end`,
  },
  {
    id: 'server-hop',
    title: 'Server hop',
    blurb: 'Finds a public server of the current place with free slots and teleports you into it.',
    category: 'server',
    tags: ['Server', 'Teleport'],
    code: `-- Aether hub · Server hop
-- Moves to a different public server of the current place.

local HttpService = game:GetService("HttpService")
local TeleportService = game:GetService("TeleportService")
local Players = game:GetService("Players")

local placeId = game.PlaceId
local cursor = ""
local servers = {}

repeat
    local url = string.format(
        "https://games.roblox.com/v1/games/%d/servers/Public?sortOrder=Asc&limit=100&cursor=%s",
        placeId,
        cursor
    )

    local ok, body = pcall(function()
        return HttpService:JSONDecode(game:HttpGet(url))
    end)

    if not ok then
        warn("Could not read the server list: " .. tostring(body))
        return
    end

    for _, server in ipairs(body.data or {}) do
        if server.playing < server.maxPlayers and server.id ~= game.JobId then
            servers[#servers + 1] = server.id
        end
    end

    cursor = body.nextPageCursor or ""
until #servers > 0 or cursor == ""

if #servers == 0 then
    warn("No open servers found")
    return
end

local target = servers[math.random(1, #servers)]
print("Hopping to " .. target)

pcall(function()
    TeleportService:TeleportToPlaceInstance(placeId, target, Players.LocalPlayer)
end)`,
  },
  {
    id: 'rejoin',
    title: 'Rejoin server',
    blurb: 'Reconnects you to the same place. Handy after a script changes the client state too far.',
    category: 'server',
    tags: ['Server', 'Quick'],
    code: `-- Aether hub · Rejoin server
local TeleportService = game:GetService("TeleportService")
local Players = game:GetService("Players")

print("Rejoining " .. tostring(game.PlaceId))
TeleportService:Teleport(game.PlaceId, Players.LocalPlayer)`,
  },
  {
    id: 'reset-character',
    title: 'Reset character',
    blurb: 'Drops your humanoid health to zero without touching the game menu.',
    category: 'character',
    tags: ['Character', 'Quick'],
    code: `-- Aether hub · Reset character
local character = game:GetService("Players").LocalPlayer.Character
local humanoid = character and character:FindFirstChildOfClass("Humanoid")

if humanoid then
    humanoid.Health = 0
    print("Character reset")
else
    warn("No humanoid found — wait for the character to load")
end`,
  },
  {
    id: 'movement-kit',
    title: 'Movement kit',
    blurb: 'Sets a comfortable walk speed and jump power on the current character. Reapplies on respawn.',
    category: 'character',
    tags: ['Character', 'Movement'],
    code: `-- Aether hub · Movement kit
local Players = game:GetService("Players")
local player = Players.LocalPlayer

local function apply(character)
    local humanoid = character and character:FindFirstChildOfClass("Humanoid")
    if not humanoid then
        return
    end

    humanoid.WalkSpeed = 34
    humanoid.UseJumpPower = true
    humanoid.JumpPower = 78
end

apply(player.Character)

player.CharacterAdded:Connect(function(character)
    task.wait(0.5)
    apply(character)
end)

print("Movement kit active · WalkSpeed 34 · JumpPower 78")`,
  },
  {
    id: 'server-info',
    title: 'Server info',
    blurb: 'Prints the place id, job id, player count and current ping for the connected server.',
    category: 'utility',
    tags: ['Utility', 'Diagnostics'],
    code: `-- Aether hub · Server info
local Players = game:GetService("Players")
local Stats = game:GetService("Stats")

local ping = "n/a"

pcall(function()
    local item = Stats.Network.ServerStatsItem["Data Ping"]
    if item then
        ping = item:GetValueString()
    end
end)

print("Place: " .. tostring(game.PlaceId))
print("Job: " .. tostring(game.JobId))
print("Players: " .. #Players:GetPlayers() .. "/" .. Players.MaxPlayers)
print("Ping: " .. ping)`,
  },
  {
    id: 'copy-position',
    title: 'Copy position',
    blurb: 'Puts your current world position on the clipboard and prints it, ready for scripts and configs.',
    category: 'utility',
    tags: ['Utility', 'Clipboard'],
    code: `-- Aether hub · Copy position
local player = game:GetService("Players").LocalPlayer
local root = player.Character and player.Character:FindFirstChild("HumanoidRootPart")

if not root then
    warn("Character is not loaded")
    return
end

local position = root.Position
local text = string.format("%.1f, %.1f, %.1f", position.X, position.Y, position.Z)

if type(setclipboard) == "function" then
    setclipboard(text)
end

print("Position: " .. text)`,
  },
  {
    id: 'clean-lighting',
    title: 'Clean lighting',
    blurb: 'Resets fog, brightness and post effects to a neutral setup for crisp screenshots.',
    category: 'visual',
    tags: ['Visual', 'Client'],
    code: `-- Aether hub · Clean lighting
local Lighting = game:GetService("Lighting")

Lighting.Ambient = Color3.fromRGB(95, 95, 95)
Lighting.OutdoorAmbient = Color3.fromRGB(110, 110, 110)
Lighting.Brightness = 2
Lighting.ClockTime = 14
Lighting.FogEnd = 100000
Lighting.GlobalShadows = true

for _, child in ipairs(Lighting:GetChildren()) do
    if child:IsA("Atmosphere") then
        child.Density = 0.25
    elseif child:IsA("BlurEffect") or child:IsA("ColorCorrectionEffect") then
        child.Enabled = false
    end
end

print("Lighting cleaned up")`,
  },
];
