function RawBlock(el)
  if el.format == "html" and el.text:match("<iframe") then
    return pandoc.RawBlock("html",
      el.text:gsub("<iframe.-src=", '<iframe width="100%%" height="600px" src=')
    )
  end
end


function Div(el)
  -- Only trigger on :::iframe blocks
  if el.classes:includes("iframe") then
    -- Grab the text inside the block
    local src = pandoc.utils.stringify(el.content):match("%S+")
    if not src then return el end

    local width  = el.attributes.width  or "100%"
    local height = el.attributes.height or "600px"

    local html = string.format(
      '<iframe src="%s" width="%s" height="%s" style="border:0;"></iframe>',
      src, width, height
    )

    return pandoc.RawBlock("html", html)
  end
end