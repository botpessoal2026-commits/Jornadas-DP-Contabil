/** Branding can use files supplied in public/brand at build time. */
export function localBrandAsset(value: string | undefined, fallback: string) {
  return value && /^\/brand\/[a-zA-Z0-9_-]+\.(?:svg|png|webp)$/.test(value)
    ? value
    : fallback;
}

export const brandAssets = {
  logo: localBrandAsset(
    process.env.NEXT_PUBLIC_BRAND_LOGO,
    "/brand/cont-contabil.svg",
  ),
  lightLogo: localBrandAsset(
    process.env.NEXT_PUBLIC_BRAND_LOGO_LIGHT,
    "/brand/cont-contabil-light.svg",
  ),
  symbol: localBrandAsset(
    process.env.NEXT_PUBLIC_BRAND_SYMBOL,
    "/brand/cont-contabil-symbol.svg",
  ),
};
