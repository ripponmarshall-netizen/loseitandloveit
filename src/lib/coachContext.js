import { addDays, daysBetween, lastNDates } from './dates.js'
import { ageFromBirthYear, adaptiveTdee, dailyTotals, entryTotals, projectGoalDate, trendOn, weeklyRate, workoutSummary } from './calc.js'
import { FREQUENCY_LABEL, MOOD_BY_V, SYMPTOM_BY_ID, SITE_BY_ID } from '../data/glp1.js'
import { planDoseStatus, doseStatusLabel, doseStep, formatDose, glp1Plan, summariseDailyLogs, waterTargetMl } from './glp1.js'

// The compact snapshot of the user's data sent with each coach message.
// Keep it small: it is re-sent every turn and billed as input tokens.
export async function buildCoachContext({ store, profile, series, targets, today }) {
  const entries = await store.listEntries(addDays(today, -27), today)
  const daily = dailyTotals(entries)
  // Workouts are optional: if the table isn't there yet, coach without them.
  const workouts = await store.listWorkouts(addDays(today, -13), today).catch(() => [])
  // GLP-1 and check-ins are optional too (migration 0003).
  const [doses, logs] = await Promise.all([
    store.listRecentDoses(12).catch(() => []),
    store.listDailyLogs(addDays(today, -13), today).catch(() => []),
  ])
  const last = series[series.length - 1]
  const rate = weeklyRate(series)
  const now = new Date()
  const plan = glp1Plan(profile)
  const waterTarget = waterTargetMl(last?.trend ?? Number(profile.start_weight_kg), profile.water_target_ml)

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
      exercise_eatback_pct: profile.exercise_eatback_pct ?? 0,
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
    workouts_last_7_days: workoutSummary(workouts.filter((w) => w.log_date > addDays(today, -7))),
    workouts_last_14_days: workouts.map((w) => ({
      date: w.log_date,
      type: w.kind === 'treadmill' ? `treadmill ${w.mode || ''}`.trim() : w.activity,
      name: w.name,
      minutes: Number(w.duration_min),
      speed_kmh: w.speed_kmh != null ? Number(w.speed_kmh) : undefined,
      incline_pct: w.incline_pct != null ? Number(w.incline_pct) : undefined,
      intensity: w.intensity || undefined,
      exercises: w.exercises?.length ? w.exercises.map((x) => `${x.name}${x.sets ? ` ${x.sets}x${x.reps}` : ''}`).join('; ') : undefined,
      net_kcal: w.calories_burned,
    })),
    glp1: plan ? glp1Context({ plan, doses, series, today }) : 'not taking a GLP-1 medicine',
    water_target_ml: waterTarget,
    daily_checkins_last_14_days: logs.length
      ? {
          summary: (({ days, mood, energy, appetite, waterMl, symptoms }) => ({
            days_logged: days,
            avg_mood_1to5: mood,
            avg_energy_1to5: energy,
            avg_appetite_1to5_3_is_normal: appetite,
            avg_water_ml: waterMl,
            symptom_days: Object.fromEntries(symptoms.map(([id, n]) => [SYMPTOM_BY_ID[id]?.label || id, n])),
          }))(summariseDailyLogs(logs)),
          days: logs.map((l) => ({
            date: l.log_date,
            mood: l.mood ? MOOD_BY_V[l.mood]?.label : undefined,
            energy: l.energy || undefined,
            appetite: l.appetite || undefined,
            water_ml: l.water_ml || undefined,
            symptoms: l.symptoms?.length ? l.symptoms.map((x) => SYMPTOM_BY_ID[x]?.label || x).join(', ') : undefined,
            note: l.note || undefined,
          })),
        }
      : 'no check-ins yet',
    today_log: entries
      .filter((e) => e.log_date === today)
      .map((e) => ({ meal: e.meal, food: e.name, servings: Number(e.servings), kcal: entryTotals(e).calories, protein_g: entryTotals(e).protein })),
  }
}

function glp1Context({ plan, doses, series, today }) {
  const status = planDoseStatus(plan, doses, today)
  const step = doseStep(plan.id, plan.dose)
  const start = plan.startedOn ? trendOn(series, plan.startedOn) || series.find((p) => p.date >= plan.startedOn) : null
  const last = series[series.length - 1]
  return {
    medicine: plan.name,
    generic: plan.med.generic,
    route: plan.route,
    frequency: FREQUENCY_LABEL[plan.frequency],
    current_dose: formatDose(plan.dose, plan.unit),
    dose_step: step ? `step ${step.step} of ${step.of} on the usual ladder (${plan.med.doses.join(', ')} ${plan.unit})` : 'not a standard step',
    started_on: plan.startedOn || undefined,
    weeks_on_medicine: plan.startedOn ? Math.floor(daysBetween(plan.startedOn, today) / 7) : undefined,
    trend_change_since_start_kg: start && last ? Math.round((last.trend - start.trend) * 10) / 10 : undefined,
    next_dose: doseStatusLabel(status),
    days_since_last_dose: doses[0] ? daysBetween(doses[0].log_date, today) : plan.startedOn ? daysBetween(plan.startedOn, today) : undefined,
    doses_logged_in_app: doses.length ? undefined : 'none yet; schedule assumes the first dose was on the start date',
    recent_doses: doses.slice(0, 6).map((d) => ({
      date: d.log_date,
      dose: formatDose(d.dose, d.unit),
      site: d.site ? SITE_BY_ID[d.site]?.label : undefined,
      notes: d.notes || undefined,
    })),
  }
}
