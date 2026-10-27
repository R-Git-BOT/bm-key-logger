-- BMKeyLogger bridge for beatoraja Lua skins.
--
-- Add the following near the end of your skin's main Lua file:
--   dofile(skin.path .. "bm_key_display_bridge.lua")
-- Then call BMKEYDISPLAY_update() from the skin's update() function.
-- Set BMKEYDISPLAY_STATE_PATH below to an absolute JSON path that matches
-- game_monitor.bridge_state_path in BMKeyLogger's config.json.

BMKEYDISPLAY_STATE_PATH = "C:/BMKeyLogger/oraja-state.json"

local bmkeydisplay_last_state = "unknown"
local bmkeydisplay_last_write = 0

local function bmkeydisplay_escape(value)
  value = tostring(value or "")
  value = string.gsub(value, "\\", "\\\\")
  value = string.gsub(value, "\"", "\\\"")
  value = string.gsub(value, "\n", "\\n")
  return value
end

local function bmkeydisplay_safe(fn)
  local ok, value = pcall(fn)
  return ok and value or nil
end

local function bmkeydisplay_phase()
  -- beatoraja/LR2oraja Lua skins normally expose the scene in the global
  -- `state`.  Keep the mapping in one function because custom skins may name
  -- their state differently.
  local raw = bmkeydisplay_safe(function() return state end)
  local value = raw and tostring(raw):lower() or ""
  if value:find("result") or value:find("finish") or value == "3" then
    return "result"
  end
  if value:find("play") or value == "2" then
    return "playing"
  end
  if value:find("decide") or value:find("loading") or value == "1" then
    return "decide"
  end
  return "select"
end

function BMKEYDISPLAY_update()
  local now = os.time()
  local phase = bmkeydisplay_phase()
  if phase == bmkeydisplay_last_state and now == bmkeydisplay_last_write then
    return
  end
  bmkeydisplay_last_state = phase
  bmkeydisplay_last_write = now

  local title = bmkeydisplay_safe(function() return SkinLuaAccessor:getTitle() end) or ""
  local artist = bmkeydisplay_safe(function() return SkinLuaAccessor:getArtist() end) or ""
  local state = string.format(
    '{"state":"%s","song":{"title":"%s","artist":"%s"}}',
    phase,
    bmkeydisplay_escape(title),
    bmkeydisplay_escape(artist)
  )
  local file = io.open(BMKEYDISPLAY_STATE_PATH, "w")
  if file then
    file:write(state)
    file:close()
  end
end
