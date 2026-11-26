import { z } from "zod";

export const clientFeatureFlagsSchema = z.object({
  canViewAccounts: z.boolean().default(true),
  canOpenAccounts: z.boolean().default(true),
  canTransferInternal: z.boolean().default(true),
  canWireExternal: z.boolean().default(true),
  canAddBeneficiaries: z.boolean().default(true),
  canInstitutionalTransfer: z.boolean().default(true),
  canViewInvestments: z.boolean().default(true),
  canTradeInvestments: z.boolean().default(false),
  canAccessCards: z.boolean().default(true),
  canRequestNewCards: z.boolean().default(true),
  canManageOwnCards: z.boolean().default(true),
  canExportStatements: z.boolean().default(true),
  canEditContactDetails: z.boolean().default(true),
  canEditPreferences: z.boolean().default(true),
});

export type ClientFeatureFlags = z.infer<typeof clientFeatureFlagsSchema>;

export const DEFAULT_CLIENT_FEATURE_FLAGS: ClientFeatureFlags = {
  canViewAccounts: true,
  canOpenAccounts: true,
  canTransferInternal: true,
  canWireExternal: true,
  canAddBeneficiaries: true,
  canInstitutionalTransfer: true,
  canViewInvestments: true,
  canTradeInvestments: false,
  canAccessCards: true,
  canRequestNewCards: true,
  canManageOwnCards: true,
  canExportStatements: true,
  canEditContactDetails: true,
  canEditPreferences: true,
};

export const noticeSeveritySchema = z.enum(["info", "warning", "critical"]);
export type NoticeSeverity = z.infer<typeof noticeSeveritySchema>;

export const clientNoticeSchema = z.object({
  enabled: z.boolean().default(false),
  title: z.string().trim().max(160).default(""),
  message: z.string().trim().max(1000).default(""),
  severity: noticeSeveritySchema.default("info"),
});

export type ClientNotice = z.infer<typeof clientNoticeSchema>;

export const DEFAULT_CLIENT_NOTICE: ClientNotice = {
  enabled: false,
  title: "",
  message: "",
  severity: "info",
};

export const clientControlsUpdateSchema = z.object({
  features: clientFeatureFlagsSchema.partial().optional(),
  notice: clientNoticeSchema.partial().optional(),
}).strict();

export const platformSettingsSchema = z.object({
  portalName: z.string().trim().min(2).max(120).default("Veritas Wealth"),
  portalTagline: z.string().trim().min(1).max(120).default("Private Banking"),
  advisorName: z.string().trim().min(2).max(120).default("Private Advisor"),
  advisorEmail: z.string().trim().email().max(254).default("veritaswealth@accountant.com"),
  maintenanceMode: z.boolean().default(false),
  maintenanceMessage: z
    .string()
    .trim()
    .max(600)
    .default("Scheduled custodial maintenance is underway. Client transactions are temporarily paused."),
  globalNoticeEnabled: z.boolean().default(false),
  globalNoticeTitle: z.string().trim().max(160).default(""),
  globalNoticeMessage: z.string().trim().max(1000).default(""),
  globalNoticeSeverity: noticeSeveritySchema.default("info"),
  marketTradingEnabled: z.boolean().default(false),
  marketPausedMessage: z
    .string()
    .trim()
    .max(400)
    .default("Trading is currently paused. Please contact your advisor."),
  applicationsOpen: z.boolean().default(true),
  cardsFeatureEnabled: z.boolean().default(true),
  investmentsFeatureEnabled: z.boolean().default(true),
  wiresFeatureEnabled: z.boolean().default(true),
  institutionalTransfersEnabled: z.boolean().default(true),
  accountOpeningEnabled: z.boolean().default(true),
  defaultSessionTimeoutMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(25)]).default(25),
});

export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  portalName: "Veritas Wealth",
  portalTagline: "Private Banking",
  advisorName: "Private Advisor",
  advisorEmail: "veritaswealth@accountant.com",
  maintenanceMode: false,
  maintenanceMessage: "Scheduled custodial maintenance is underway. Client transactions are temporarily paused.",
  globalNoticeEnabled: false,
  globalNoticeTitle: "",
  globalNoticeMessage: "",
  globalNoticeSeverity: "info",
  marketTradingEnabled: false,
  marketPausedMessage: "Trading is currently paused. Please contact your advisor.",
  applicationsOpen: true,
  cardsFeatureEnabled: true,
  investmentsFeatureEnabled: true,
  wiresFeatureEnabled: true,
  institutionalTransfersEnabled: true,
  accountOpeningEnabled: true,
  defaultSessionTimeoutMinutes: 25,
};

export const cardKindSchema = z.enum(["physical", "virtual", "one_time", "business_platinum"]);
export type CardKind = z.infer<typeof cardKindSchema>;

export const cardStatusSchema = z.enum(["active", "locked", "frozen", "cancelled"]);
export type CardStatus = z.infer<typeof cardStatusSchema>;

export const cardNetworkSchema = z.enum(["Visa", "Mastercard"]);
export type CardNetwork = z.infer<typeof cardNetworkSchema>;

export type ClientCardRecord = {
  id: number;
  userId: number;
  accountId: number | null;
  cardKind: CardKind;
  label: string;
  last4: string;
  expiry: string;
  network: CardNetwork;
  status: CardStatus;
  fraudProtection: boolean;
  dailyLimit: string;
  onlinePayments: boolean;
  internationalSpend: boolean;
  adminNotes: string | null;
  createdAt: string;
  userName?: string;
  userEmail?: string;
  userClientRef?: string | null;
  accountLabel?: string | null;
};

export type EffectiveClientControls = {
  platform: PlatformSettings;
  features: ClientFeatureFlags;
  notice: ClientNotice;
  effective: ClientFeatureFlags;
};

export function resolveEffectiveFeatures(
  platform: PlatformSettings,
  features: ClientFeatureFlags,
): ClientFeatureFlags {
  return {
    canViewAccounts: features.canViewAccounts,
    canOpenAccounts: platform.accountOpeningEnabled && features.canOpenAccounts,
    canTransferInternal: features.canTransferInternal,
    canWireExternal: platform.wiresFeatureEnabled && features.canWireExternal,
    canAddBeneficiaries: platform.wiresFeatureEnabled && features.canAddBeneficiaries,
    canInstitutionalTransfer: platform.institutionalTransfersEnabled && features.canInstitutionalTransfer,
    canViewInvestments: platform.investmentsFeatureEnabled && features.canViewInvestments,
    canTradeInvestments:
      platform.investmentsFeatureEnabled && platform.marketTradingEnabled && features.canTradeInvestments,
    canAccessCards: platform.cardsFeatureEnabled && features.canAccessCards,
    canRequestNewCards: platform.cardsFeatureEnabled && features.canAccessCards && features.canRequestNewCards,
    canManageOwnCards: platform.cardsFeatureEnabled && features.canAccessCards && features.canManageOwnCards,
    canExportStatements: features.canExportStatements,
    canEditContactDetails: features.canEditContactDetails,
    canEditPreferences: features.canEditPreferences,
  };
}
