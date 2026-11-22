-- Aether bridge
-- Paste this into your executor and run it once per session.
-- The desktop app must be open and listening on the port below.

local ENDPOINT = "ws://127.0.0.1:__PORT__/bridge"
local RETRY_SECONDS = 3
local SILENCE_LIMIT = 90
local LOADER_VERSION = 2

local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")

local compiler = loadstring or load
if type(compiler) ~= "function" then
    if rconsolewarn then
        pcall(rconsolewarn, "Aether: this executor does not expose loadstring/load.")
    end
    return
end

local function notify(message)
    local text = "Aether: " .. tostring(message)
    if rconsoleprint then
        pcall(rconsoleprint, text)
    elseif print then
        pcall(print, text)
    end
end

-- Keep a single loader instance alive when the script is executed more than once.
-- Running the loader again replaces the token and retires the previous instance.
local shared = _G
pcall(function()
    if type(getgenv) == "function" then
        local env = getgenv()
        if type(env) == "table" then
            shared = env
        end
    end
end)

local token = {}
shared.__AETHER_BRIDGE_V1__ = token

local function active()
    return shared.__AETHER_BRIDGE_V1__ == token
end

local function encode(value)
    local ok, result = pcall(function()
        return HttpService:JSONEncode(value)
    end)
    if ok and type(result) == "string" then
        return result
    end
    return nil
end

local function decode(value)
    local ok, result = pcall(function()
        return HttpService:JSONDecode(value)
    end)
    if ok then
        return result
    end
    return nil
end

local function openSocket()
    local ok, socket = pcall(function()
        if WebSocket ~= nil and type(WebSocket.connect) == "function" then
            return WebSocket.connect(ENDPOINT)
        end
        if type(WebSocket) == "function" then
            return WebSocket(ENDPOINT)
        end
        if type(websocket) == "table" and type(websocket.connect) == "function" then
            return websocket.connect(ENDPOINT)
        end
        if type(websocket) == "function" then
            return websocket(ENDPOINT)
        end
        if type(syn) == "table" and type(syn.websocket) == "table" and type(syn.websocket.connect) == "function" then
            return syn.websocket.connect(ENDPOINT)
        end
        if type(syn) == "table" and type(syn.websocket) == "function" then
            return syn.websocket(ENDPOINT)
        end
        error("the executor does not expose a WebSocket API")
    end)
    if ok and socket ~= nil then
        return socket
    end
    return nil, tostring(socket)
end

local function closeSocket(socket)
    local ok = pcall(function()
        socket:Close()
    end)
    if not ok then
        pcall(function()
            socket:close()
        end)
    end
end

-- Executors expose websocket events differently. Some hand back a signal that
-- needs :Connect (Potassium, Synapse, most modern executors), others accept a
-- callback assigned to OnMessage. Support both instead of guessing.
local function attach(socket, names, handler)
    for _, name in ipairs(names) do
        local ok, event = pcall(function()
            return socket[name]
        end)

        if ok and event ~= nil then
            local okConnect, connect = pcall(function()
                return event.Connect
            end)
            if okConnect and type(connect) == "function" then
                local bound = pcall(function()
                    event:Connect(handler)
                end)
                if bound then
                    return name
                end
            end

            local called = pcall(function()
                event(handler)
            end)
            if called then
                return name
            end
        end

        local assigned = pcall(function()
            socket[name] = handler
        end)
        if assigned then
            return name
        end
    end
    return nil
end

local function executorName()
    local ok, name = pcall(identifyexecutor)
    if ok and type(name) == "string" and name ~= "" then
        return name
    end
    return "Unknown"
end

local gameName = tostring(game.Name or "")
if gameName == "" or gameName == "Game" then
    gameName = "Place " .. tostring(game.PlaceId)
end

local localPlayer = Players.LocalPlayer
local activeSend = nil
local capturing = false

-- Reuse the original print/warn so re-running the loader does not nest wrappers.
local originalPrint = shared.__AETHER_ORIGINAL_PRINT__ or print
local originalWarn = shared.__AETHER_ORIGINAL_WARN__ or warn

pcall(function()
    shared.__AETHER_ORIGINAL_PRINT__ = originalPrint
    shared.__AETHER_ORIGINAL_WARN__ = originalWarn
end)

local function joinArgs(...)
    local parts = {}
    for index = 1, select("#", ...) do
        parts[#parts + 1] = tostring(select(index, ...))
    end
    return table.concat(parts, " ")
end

local function push(level, message)
    if activeSend then
        activeSend({
            type = "log",
            level = level,
            message = tostring(message),
        })
    end
end

pcall(function()
    print = function(...)
        originalPrint(...)
        if capturing then
            push("info", joinArgs(...))
        end
    end

    warn = function(...)
        originalWarn(...)
        if capturing then
            push("warn", joinArgs(...))
        end
    end
end)

local function runSnippet(message)
    if not activeSend then
        return
    end

    if type(message.code) ~= "string" or message.code == "" then
        activeSend({ type = "result", id = message.id, ok = false, message = "Empty script" })
        return
    end

    local chunk, compileError = compiler(message.code)
    if not chunk then
        activeSend({ type = "result", id = message.id, ok = false, message = "Syntax error: " .. tostring(compileError) })
        return
    end

    capturing = true
    local started = os.clock()
    local ok, runtimeError = pcall(chunk)
    capturing = false

    local elapsed = math.floor((os.clock() - started) * 1000 + 0.5)
    if ok then
        activeSend({ type = "result", id = message.id, ok = true, message = "Finished in " .. elapsed .. " ms" })
    else
        activeSend({ type = "result", id = message.id, ok = false, message = tostring(runtimeError) })
    end
end

local function parseMessage(raw)
    -- Most executors deliver a JSON string. Some deliver a frame object with a
    -- Data field, and a few deliver an already-decoded table.
    if type(raw) == "table" then
        local payload = raw.Data or raw.data or raw.Message or raw.message
        if type(payload) == "string" then
            raw = payload
        elseif type(raw.type) == "string" then
            return raw
        end
    elseif type(raw) ~= "string" then
        local ok, text = pcall(tostring, raw)
        if ok then
            raw = text
        end
    end

    local message = decode(raw)
    if type(message) == "table" then
        return message
    end
    return nil
end

local function runSession(socket)
    local closed = false
    local lastInbound = os.clock()

    local function send(payload)
        local encoded = encode(payload)
        if not encoded then
            return false
        end
        local ok = pcall(function()
            socket:Send(encoded)
        end)
        if not ok then
            ok = pcall(function()
                socket:send(encoded)
            end)
        end
        return ok
    end

    activeSend = send

    local function stop()
        closed = true
        if activeSend == send then
            activeSend = nil
        end
        closeSocket(socket)
    end

    local function onMessage(raw)
        if closed then
            return
        end

        lastInbound = os.clock()
        local message = parseMessage(raw)
        if not message then
            return
        end

        if message.type == "execute" then
            task.spawn(function()
                local ok, err = pcall(runSnippet, message)
                if not ok and activeSend then
                    activeSend({ type = "result", id = message.id, ok = false, message = tostring(err) })
                end
            end)
        elseif message.type == "ping" then
            send({ type = "pong" })
        elseif message.type == "disconnect" then
            -- An explicit disconnect from the desktop app retires this loader.
            -- Re-run the loader to reconnect.
            if active() then
                shared.__AETHER_BRIDGE_V1__ = nil
            end
            stop()
        end
    end

    local messageEvent = attach(socket, { "OnMessage", "onMessage" }, onMessage)

    local hello = {
        type = "hello",
        protocol = 1,
        loader = LOADER_VERSION,
        game = gameName,
        placeId = game.PlaceId,
        jobId = game.JobId,
        player = localPlayer and localPlayer.Name or "Player",
        displayName = localPlayer and localPlayer.DisplayName or "Player",
        executor = executorName(),
    }

    if not send(hello) then
        stop()
        return
    end

    if not messageEvent then
        send({
            type = "log",
            level = "error",
            message = "Aether could not bind to the WebSocket message event. This executor's WebSocket API is not compatible with the loader.",
        })
        task.wait(0.25)
        if active() then
            shared.__AETHER_BRIDGE_V1__ = nil
        end
        stop()
        return
    end

    attach(socket, { "OnClose", "onClose" }, function()
        closed = true
    end)

    attach(socket, { "OnError", "onError" }, function()
        closed = true
    end)

    while not closed and active() do
        task.wait(0.25)
        if os.clock() - lastInbound > SILENCE_LIMIT then
            stop()
        end
    end

    if activeSend == send then
        activeSend = nil
    end
    closeSocket(socket)
end

local failures = 0

while active() do
    local socket, err = openSocket()
    if socket then
        failures = 0
        runSession(socket)
    else
        failures = failures + 1
        if failures == 1 or failures % 20 == 0 then
            notify(err)
        end
    end

    if active() then
        task.wait(RETRY_SECONDS)
    end
end
