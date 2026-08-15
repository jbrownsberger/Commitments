-- Persist Google Calendar UI settings per user (write calendar, read calendars, calc settings).
alter table public.user_preferences
  add column if not exists gcal_write_cal_id text;

alter table public.user_preferences
  add column if not exists gcal_selected_cals jsonb;

alter table public.user_preferences
  add column if not exists gcal_calc_settings jsonb;
