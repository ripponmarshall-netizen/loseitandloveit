import { addDays, lastNDates } from './dates.js'
import { ageFromBirthYear, adaptiveTdee, dailyTotals, entryTotals, projectGoalDate, weeklyRate } from './calc.js'

// The compact snapshot of the user's data sent with each coach message.
// Keep it small: it is re-sent every turn and billed as input tokens.
export async function buildCoachContext({ store, profile, series, targets, today }) {
  const entries = await store.listEntries(addDays(today, -27), today)
  const daily = dailyTotals(entries)
  const last = series[series.length - 1]
  const rate = weeklyRate(series)
  const now = new Date()

  return {
    note: 'All weights in kg. Talk to the user in their preferred units.',
    today,
    local_time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    profile: {
      name: profile.display_name || undefined,
      sex: profile.sex,
      age: ageFromBirthYear(profile.birth_year),
      height_cm: Number(profile.height_cm),
      activity_level: profile.activity_level,
      goal_weight_kg: Number(profile.goal_weight_kg),
      planned_weekly_loss_kg: Number(profile.weekly_rate_kg),
      preferred_units: profile.units === 'imperial' ? 'lb, ft/in' : 'kg, cm',
      day_starts_at_hour: profile.day_start_hour,
      coach_notes: profile.coach_notes || undefined,
    },
    targets: targets && {
      calories: targets.calories,
      protein_g: targets.protein,
      carbs_g: targets.carbs,
      fat_g: targets.fat,
      formula_maintenance_kcal: targets.tdee,
      warnings: targets.warnings.length ? targets.warnings : undefined,
    },
    weight: last && {
      latest_weigh_in: { date: last.date, kg: last.weight },
      trend_kg: last.trend,
      start_kg: Number(profile.start_weight_kg),
      weekly_change_kg: rate == null ? null : Math.round(rate * 100) / 100,
      projected_goal_date: projectGoalDate(series, Number(profile.goal_weight_kg), today, rate),
      weigh_ins_last_28_days: series.filter((p) => p.date >= addDays(today, -27)).length,
    },
    adaptive_maintenance: adaptiveTdee({ daily, series, endDate: addDays(today, -1) }) || 'not enough data yet',
    last_14_days: lastNDates(today, 14).map((d) => ({
      date: d,
      kcal: daily[d]?.calories ?? 0,
      protein_g: daily[d]?.protein ?? 0,
      items_logged: daily[d]?.count ?? 0,
    })),
    today_log: entries
      .filter((e) => e.log_date === today)
      .map((e) => ({ meal: e.meal, food: e.name, servings: Number(e.servings), kcal: entryTotals(e).calories, protein_g: entryTotals(e).protein })),
  }
}
