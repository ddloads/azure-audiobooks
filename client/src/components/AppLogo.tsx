interface AppLogoProps {
  className?: string;
  imageClassName?: string;
  textClassName?: string;
  showWordmark?: boolean;
}

const AppLogo = ({
  className = "",
  imageClassName = "",
  textClassName = "",
  showWordmark = true,
}: AppLogoProps) => {
  const rootClassName = className ? `app-logo ${className}` : "app-logo";
  const imgClassName = imageClassName ? `app-logo-image ${imageClassName}` : "app-logo-image";
  const wordmarkClassName = textClassName
    ? `app-logo-wordmark ${textClassName}`
    : "app-logo-wordmark";

  return (
    <div className={rootClassName}>
      <img src="/azure-logo.png" alt="Azure logo" className={imgClassName} />
      {showWordmark && <span className={wordmarkClassName}>Azure</span>}
    </div>
  );
};

export default AppLogo;
