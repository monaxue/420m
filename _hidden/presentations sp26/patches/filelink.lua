-- filelink.lua
-- For any link with class "filelink", generate:
--   [Original text] · [↗] · [⤓]
-- Icons have tooltips: "Open in new tab" and "Download file".

local function has_class(el, class)
  if not el.classes then return false end
  for _, c in ipairs(el.classes) do
    if c == class then
      return true
    end
  end
  return false
end

function Link(el)
  -- Only transform links with .filelink
  if not has_class(el, "filelink") then
    -- Add target="_blank" while preserving everything else
    el.attributes = el.attributes or {}
    el.attributes.target = "_blank"
    el.attributes.rel = "noopener noreferrer"
    return el
  end

  local url = el.target
  local text = el.content

  -- Original text link (normal)
  local main_link = pandoc.Link(text, url)

  -- "Open in new tab" icon 🔗
  local open_icon = { pandoc.Str("↗") }
  local open_link = pandoc.Link(
    open_icon,
    url,
    "",  -- no separate title arg; use attributes instead
    {
      target = "_blank",
      title = "Open in new tab"
    }
  )

  -- "Download file" icon ⬇
  local download_icon = { pandoc.Str("⤓") }
  local download_link = pandoc.Link(
    download_icon,
    url,
    "",
    {
      download = "",
      title = "Download file"
    }
  )

  -- Build: [text] · [↗] · [⤓]
  local space = pandoc.Space()
  local dot = pandoc.Str("·")

  return pandoc.Span{
    main_link,
    space, dot, space,
    open_link,
    space, dot, space,
    download_link
  }
end
