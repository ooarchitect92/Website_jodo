export type TenantQuestion = {
  key: string;
  label: string;
  kind: 'short_text' | 'long_text' | 'choice';
  required: boolean;
  options: string[];
};
