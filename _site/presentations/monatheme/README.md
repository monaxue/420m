# Monatheme

## Installing

*TODO*: Replace the `<github-organization>` with your GitHub organization.

```bash
quarto use template <github-organization>/<%= filesafename %>
```

This will install the extension and create an example qmd file that you can use as a starting place for your article.

## Using

Specify in your front matter or YAML file

```
format: 
    monatheme-revealjs: default

```

For each slide, specify the desired mini-theme by wrapping with the following:

```

::: {.theme-<color>}

# Example header

Example text


:::

```


## Format Options

*TODO*: If your format has options that can be set via document metadata, describe them.

## Example

Here is the source code for a minimal sample document: [example.qmd](example.qmd).
