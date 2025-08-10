Sweep /src for:
- inline style props (style={{ ... }}) in JSX/TSX
- non-token colors (hex/rgb/hsl) in sx/JSX
- non-token spacings (px/rem/em literals) in sx/JSX
- inconsistent typography variants not in theme scale
- button sizes that deviate from theme defaults

Standardize to theme tokens:
- colors: use palette (theme.palette.*) and hrx tokens from theme
- spacing: use theme.spacing(n)
- radii: theme.shape.borderRadius or component overrides
- typography: use theme.typography variants (h1..h6, body1, body2, caption, button)

For each file, propose edits (before/after) and capture screenshots with Playwright on key routes.


