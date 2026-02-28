# For this function, to name the ticks on the x-axes, assign your values to variables with the name you want before putting them in the function.

# For example:

# `mu[threshold]` <- 0
# `bar(x)[observed]` <- 1.5
# 
# area_under_norm(mu=`mu[threshold]`, sd=1, type="right", bounds=c(`bar(x)[observed]`), show_percent = FALSE)
# 
# area_under_norm <- function(mu, sd, type ="inner", alpha=NA, bounds = c(), fill = "steelblue", show_percent=TRUE){

# the variable name can be in a format that the function `expression()` can recognize. It will be rendered in the final plot as math text.

# Todo's
# add ability to change general font size so it works with different image sizes. I will have to specify a groups of font sizes that work for different image sizes.

area_under_norm <- function(mu, sd, type ="inner", alpha=NA, bounds = c(), fill = "steelblue", show_percent=TRUE){


if (show_percent==TRUE){
        percent_col = "black"
} else{
        percent_col = "transparent"
}

  library(ggplot2)

  # ---- helper: centroid of region under curve y(x) over a masked subset ----
  centroid_under_curve <- function(x, y, keep) {
    ys <- ifelse(keep, y, 0)

    dx <- diff(x)

    # Area A = ∫ ys dx  (trapezoid)
    A <- sum(((ys[-1] + ys[-length(ys)]) / 2) * dx)

    # x-moment Mx = ∫ x*ys dx  (trapezoid on x*ys)
    f <- x * ys
    Mx <- sum(((f[-1] + f[-length(f)]) / 2) * dx)

    # ybar uses: ybar = (1/(2A)) ∫ ys^2 dx
    ys2 <- ys^2
    Iy2 <- sum(((ys2[-1] + ys2[-length(ys2)]) / 2) * dx)

    c(xbar = Mx / A, ybar = (Iy2 / (2 * A)), area = A)
  }

  x <- seq(mu - 4*sd, mu + 4*sd, length.out = 1000)

  df <- tibble::tibble(
    x = x,
    y = dnorm(x, mu, sd)
  )

  center_lab <- parse(text=deparse(substitute(mu)))
  vals <- c()

  if (is.na(alpha) == FALSE){
    vals <- c(vals, qnorm(alpha/2, mu, sd))
    vals <- c(vals, qnorm(1-(alpha/2), mu, sd))
    z <- round(abs(qnorm(alpha/2, 0, 1)), 2)
    names(vals) <- c(paste0("mu-" , z , " %*% SE"), paste0("mu+" , z , " %*% SE"))
  }

  if (length(bounds) > 0){
    expr <- substitute(bounds)
    vars <- sapply(as.list(expr)[-1], deparse)
    names(bounds) <- vars
    vals <- c(vals, bounds)
  }

  lower_val <- min(vals)
  upper_val <- max(vals)
  lower_lab <- parse(text=names(vals)[vals == lower_val])
  upper_lab <- parse(text=names(vals)[vals == upper_val])

  plot <- ggplot(df, aes(x=x, y=y)) +
    geom_line() + labs(x = NULL, y = NULL) + 
    scale_x_continuous(
      breaks = c(lower_val, mu, upper_val),
      labels = c(lower_lab, center_lab, upper_lab)
    ) +
    scale_y_continuous(expand = c(0, 0)) +
    theme_classic(base_size = 10) +
    theme(
      plot.margin = margin(b = rel(2), r = rel(2), l=rel(2), t=rel(2)),
      panel.background = element_rect(fill = "transparent"),
      plot.background  = element_rect(fill = "transparent"),
      axis.title.y = element_blank(),
      axis.title.x = element_blank(),
      axis.text.y  = element_blank(),
      axis.ticks.y = element_blank(),
      axis.ticks.length.x = unit(4, "pt"),
      axis.text.x = element_text(size = rel(2), margin = margin(t = rel(4)))
    )

  if (type == "outer") {

    # left tail centroid
    keep_left  <- df$x < lower_val
    c_left <- centroid_under_curve(df$x, df$y, keep_left)

    # right tail centroid
    keep_right <- df$x > upper_val
    c_right <- centroid_under_curve(df$x, df$y, keep_right)

    percent_lower <- paste0(round(100 * pnorm(lower_val, mu, sd), 2), "%")
    percent_upper <- paste0(round(100 * (1 - pnorm(upper_val, mu, sd)), 2), "%")

    plot <- plot +
      geom_area(aes(y = ifelse(df$x < lower_val | df$x > upper_val, y, 0)),
                alpha = 0.2, fill = fill) +
      geom_vline(xintercept = c(lower_val, mu, upper_val), linetype = "dashed") +
      annotate("text", x = c_left["xbar"],  y = c_left["ybar"],  label = percent_lower, size = 8, color=percent_col) +
      annotate("text", x = c_right["xbar"], y = c_right["ybar"], label = percent_upper, size = 8,color=percent_col)

  } else if (type == "inner") {

    keep <- df$x > lower_val & df$x < upper_val
    c_in <- centroid_under_curve(df$x, df$y, keep)

    percent <- paste0(round(100 * (pnorm(upper_val, mu, sd) - pnorm(lower_val, mu, sd)), 2), "%")

    plot <- plot +
      geom_area(aes(y = ifelse(keep, y, 0)), alpha = 0.2, fill = fill) +
      geom_vline(xintercept = c(lower_val, mu, upper_val), linetype = "dashed") +
      annotate("text", x = c_in["xbar"], y = c_in["ybar"], label = percent, size = 8,color=percent_col)

  } else if (type == "left") {

    threshold <- upper_val
    keep <- df$x < threshold
    c_left <- centroid_under_curve(df$x, df$y, keep)

    percent <- paste0(round(100 * pnorm(threshold, mu, sd), 2), "%")

    plot <- plot +
      geom_area(aes(y = ifelse(keep, y, 0)), alpha = 0.2, fill = fill) +
      geom_vline(xintercept = c(lower_val, mu, upper_val), linetype = "dashed") +
      annotate("text", x = c_left["xbar"], y = c_left["ybar"], label = percent, size = 8,color=percent_col)

  } else if (type == "right") {

    threshold <- lower_val
    keep <- df$x > threshold
    c_right <- centroid_under_curve(df$x, df$y, keep)

    percent <- paste0(round(100 * (1 - pnorm(threshold, mu, sd)), 2), "%")

    plot <- plot +
      geom_area(aes(y = ifelse(keep, y, 0)), alpha = 0.2, fill = fill) +
      geom_vline(xintercept = c(lower_val, mu, upper_val), linetype = "dashed") +
      annotate("text", x = c_right["xbar"], y = c_right["ybar"], label = percent, size = 8,color=percent_col)
  }

  return(plot)
}