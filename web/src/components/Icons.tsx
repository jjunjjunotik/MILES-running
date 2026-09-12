/** 외부 아이콘 패키지 없이 쓰는 인라인 SVG 모음. 모두 currentColor 를 따른다. */
export interface IconProps {
  size?: number;
  strokeWidth?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const HomeIcon = ({ size = 21, strokeWidth = 1.7 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20h13V9.5" />
  </svg>
);

export const ScanIcon = ({ size = 21, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8" />
    <path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8" />
    <path d="M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16" />
    <path d="M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
    <path d="M7.5 12h9" />
  </svg>
);

export const ResultIcon = ({ size = 21, strokeWidth = 1.7 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <rect x="4" y="3" width="16" height="18" rx="3" />
    <path d="M8.5 9h7M8.5 13h7M8.5 17h4" />
  </svg>
);

export const HistoryIcon = ({ size = 21, strokeWidth = 1.7 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3 4v4.2h4.2" />
    <path d="M12 7.8V12l3 1.8" />
  </svg>
);

export const ProfileIcon = ({ size = 21, strokeWidth = 1.7 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <circle cx="12" cy="8.5" r="3.7" />
    <path d="M4.6 20a7.6 7.6 0 0 1 14.8 0" />
  </svg>
);

export const CameraIcon = ({ size = 21, strokeWidth = 1.7 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M4 8.5h3l1.4-2.2h7.2L17 8.5h3v11H4z" />
    <circle cx="12" cy="14" r="3.4" />
  </svg>
);

export const UploadIcon = ({ size = 21, strokeWidth = 1.7 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M12 16V4" />
    <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
    <path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" />
  </svg>
);

export const InfoIcon = ({ size = 15, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 7.6h.01" />
  </svg>
);

export const ShieldIcon = ({ size = 15, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M12 3 5 6v5.5c0 4.3 2.9 7.6 7 9.5 4.1-1.9 7-5.2 7-9.5V6z" />
    <path d="m9.3 12.2 1.9 1.9 3.5-3.8" />
  </svg>
);

export const ChevronIcon = ({ size = 17, strokeWidth = 2 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="m9.5 6 6 6-6 6" />
  </svg>
);

export const CheckIcon = ({ size = 12, strokeWidth = 2.6 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

export const ShareIcon = ({ size = 18, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M12 15V3.5" />
    <path d="m8 7.5 4-4 4 4" />
    <path d="M5 13v5.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V13" />
  </svg>
);

export const DownloadIcon = ({ size = 18, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M12 3.5V15" />
    <path d="m8 11 4 4 4-4" />
    <path d="M5 15v3.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V15" />
  </svg>
);

export const TrashIcon = ({ size = 17, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M4.5 6.5h15" />
    <path d="M9 6.5V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8v1.7" />
    <path d="M6.5 6.5 7.4 20a1.4 1.4 0 0 0 1.4 1.3h6.4a1.4 1.4 0 0 0 1.4-1.3l.9-13.5" />
  </svg>
);

export const SparkIcon = ({ size = 18, strokeWidth = 1.7 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9z" />
  </svg>
);

export const DropIcon = ({ size = 18, strokeWidth = 1.7 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M12 3.5c3 3.6 5.5 6.7 5.5 9.6A5.5 5.5 0 0 1 6.5 13c0-2.9 2.5-6 5.5-9.5z" />
  </svg>
);

export const LeafIcon = ({ size = 18, strokeWidth = 1.7 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M20 4c0 8.5-4.5 13-11 13H5.5" />
    <path d="M5 20c0-6 4-10 10-11" />
  </svg>
);

export const MoonIcon = ({ size = 18, strokeWidth = 1.7 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </svg>
);

export const HandIcon = ({ size = 18, strokeWidth = 1.7 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M8.5 11V5.2a1.6 1.6 0 0 1 3.2 0V10" />
    <path d="M11.7 10V4.4a1.6 1.6 0 0 1 3.2 0V10" />
    <path d="M14.9 10.2V6.6a1.6 1.6 0 1 1 3.2 0v7.6c0 3.7-2.6 6.3-6.2 6.3-3.3 0-5-1.8-6.3-4.4l-2-4a1.6 1.6 0 0 1 2.7-1.7l2.4 3.1" />
  </svg>
);

export const TrendIcon = ({ size = 18, strokeWidth = 1.8 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="m3.5 15.5 5-5 3.5 3.5 6-6.5" />
    <path d="M14.5 7h4v4" />
  </svg>
);

export const ArrowUpIcon = ({ size = 12, strokeWidth = 2.4 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M12 19V5" />
    <path d="m6 11 6-6 6 6" />
  </svg>
);

export const ArrowDownIcon = ({ size = 12, strokeWidth = 2.4 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M12 5v14" />
    <path d="m6 13 6 6 6-6" />
  </svg>
);

export const MinusIcon = ({ size = 12, strokeWidth = 2.4 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M6 12h12" />
  </svg>
);

export const StethoscopeIcon = ({ size = 18, strokeWidth = 1.7 }: IconProps) => (
  <svg {...base(size)} strokeWidth={strokeWidth}>
    <path d="M5 3.5v5a4 4 0 0 0 8 0v-5" />
    <path d="M4 3.5h2M12 3.5h2" />
    <path d="M9 12.5v2.2a4.3 4.3 0 0 0 8.6 0v-1.4" />
    <circle cx="17.6" cy="11" r="2.1" />
  </svg>
);
