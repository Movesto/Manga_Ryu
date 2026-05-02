export function MangaRyuLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      {/* Main dragon-flame body */}
      <path
        d="M14 2C10.5 2 7.5 4.5 7 8.5C6.5 12 8.5 14.5 10 17.5C11 19.5 10.5 22.5 9 25C11.5 23.5 14.5 21 15.5 18C16 20.5 15.5 23.5 13.5 26C16 24.5 19 22 20 18.5C21 15.5 20.5 11.5 18.5 9C17.5 7 17.5 4.5 19 2.5C17.5 2.2 15.7 2 14 2Z"
        fill="#f97316"
      />
      {/* Inner flame highlight */}
      <path
        d="M13.5 7.5C12.5 10 12.5 13 13.5 15.5C14 17 14 19 13 21.5C15 19.5 16 17 15.5 14C15 11.5 14.2 9 13.5 7.5Z"
        fill="#fbbf24"
      />
      {/* Dragon horn – upper right */}
      <path d="M18.5 3.5C21 1.5 24 2.5 23 5.5C22.5 7.5 19.5 6.5 18.5 3.5Z" fill="#fb923c" />
      {/* Dragon wing accent – lower left */}
      <path d="M7 11C4.5 9.5 3 12 5 13.5C6 14.5 8 13.5 7 11Z" fill="#fb923c" />
    </svg>
  );
}

export const SITE_NAME = "Manga Ryu";
