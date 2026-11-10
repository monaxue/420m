-- filelink.lua
-- All links get the filelink treatment by default:
--   [Original text] · [↗] · [⤓]
-- Opt out per-link with: {filelink=false}

local function has_class(el, class)
  if not el.classes then return false end
  for _, c in ipairs(el.classes) do
    if c == class then
      return true
    end
  end
  return false
end

local function clean_url(url)
  -- Fix Windows path separators in leading ./ or ../
  url = url:gsub("^%.\\", "./")
  url = url:gsub("^%.%.\\", "../")
  -- Remove pandoc's backslash-escaping of remaining characters (e.g. \_ -> _)
  url = url:gsub("\\(.)", "%1")
  return url
end

local function basename(url)
  -- Extract filename from URL (after last / or \)
  return url:match("[^/\\]+$") or ""
end

function Link(el)
  -- Never re-transform links we already produced.
  if has_class(el, "fl-generated") then
    return el
  end

  -- Opt out: {filelink=false}
  if (el.attributes or {}).filelink == "false" then
    el.attributes = el.attributes or {}
    el.attributes.target = "_blank"
    el.attributes.rel = "noopener noreferrer"
    return el
  end

  local url = clean_url(el.target)
  local filename = basename(url)
  local text = el.content

  -- Main text link: plain on website, new tab on revealjs
  local main_attrs = { class = "fl-generated" }
  if FORMAT and FORMAT:match("revealjs") then
    main_attrs.target = "_blank"
    main_attrs.rel = "noopener noreferrer"
  end
  local main_link = pandoc.Link(text, url, "", main_attrs)

  -- "Open in new tab" icon ↗
  local open_link = pandoc.Link(
    { pandoc.Str("↗") },
    url,
    "",
    {
      target = "_blank",
      rel = "noopener noreferrer",
      title = "Open in new tab",
      class = "fl-generated"
    }
  )

  -- "Download file" icon ⤓
  local download_link = pandoc.Link(
    { pandoc.Str("⤓") },
    url,
    "",
    {
      download = filename,
      title = "Download file",
      target = "_blank",
      rel = "noopener noreferrer",
      class = "fl-generated"
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
