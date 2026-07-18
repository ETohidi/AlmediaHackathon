const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export const buildBusinessModel = (db) => {
  const assumptions = db.business_model
  const gameEconomics = db.games.map((game) => {
    const model = assumptions.game_assumptions[game.id]
    const allocatedUsers = db.countries.reduce((sum, country) => {
      const weights = db.country_game_model.weights_by_continent[country.continent_id]
      return sum + Math.round(country.total_users * (weights?.[game.id] ?? 0))
    }, 0)
    const monthlyActiveUsers = Math.round(allocatedUsers * assumptions.monthly_active_share)
    const paidCompletions = Math.round(monthlyActiveUsers * model.paid_completion_rate)
    const advertiserRevenue = paidCompletions * model.advertiser_revenue_per_completion_usd
    const userRewards = paidCompletions * model.user_reward_per_completion_usd
    const variableCosts = advertiserRevenue * assumptions.variable_operations_rate
    const monthlyProfit = advertiserRevenue - userRewards - variableCosts
    const margin = advertiserRevenue ? monthlyProfit / advertiserRevenue : 0
    const riskScore = Math.round(clamp(
      (1 - model.assumption_confidence) * 45 + model.reward_dispute_rate * 500 + (margin < 0.12 ? 25 : margin < 0.2 ? 12 : 0),
      0,
      100,
    ))

    return {
      id: game.id,
      name: game.name,
      allocated_users: allocatedUsers,
      monthly_active_users: monthlyActiveUsers,
      paid_completions: paidCompletions,
      advertiser_revenue_usd: Math.round(advertiserRevenue),
      user_rewards_usd: Math.round(userRewards),
      variable_costs_usd: Math.round(variableCosts),
      monthly_profit_usd: Math.round(monthlyProfit),
      contribution_margin: Math.round(margin * 1000) / 1000,
      risk_score: riskScore,
      confidence: model.assumption_confidence,
      assumptions: model,
      data_status: 'modeled_scenario',
    }
  })

  const infrastructureCases = db.country_infrastructure
    .filter((entry) => entry.status !== 'healthy')
    .map((entry) => {
      const country = db.countries.find((candidate) => candidate.id === entry.country_id)
      const monthlyRevenueAtRisk = Math.round(
        (country?.total_users ?? 0) * assumptions.monthly_active_share * assumptions.revenue_at_risk_per_active_user_usd *
          clamp((entry.p95_postback_latency_ms - 180) / 300 + entry.postback_failure_rate * 4, 0.03, 0.45),
      )
      const upgradeCost = Math.round(
        assumptions.infrastructure.base_upgrade_cost_usd +
          (country?.total_users ?? 0) * assumptions.infrastructure.cost_per_supported_user_usd,
      )
      const monthlyOperatingCost = Math.round(upgradeCost * assumptions.infrastructure.monthly_opex_rate)
      const expectedRecovery = Math.round(monthlyRevenueAtRisk * assumptions.infrastructure.expected_recovery_rate)
      const paybackMonths = expectedRecovery > monthlyOperatingCost
        ? upgradeCost / (expectedRecovery - monthlyOperatingCost)
        : null

      return {
        country_id: entry.country_id,
        country_name: country?.name ?? entry.country_id,
        status: entry.status,
        p95_postback_latency_ms: entry.p95_postback_latency_ms,
        monthly_revenue_at_risk_usd: monthlyRevenueAtRisk,
        one_time_upgrade_cost_usd: upgradeCost,
        monthly_operating_cost_usd: monthlyOperatingCost,
        expected_monthly_recovery_usd: expectedRecovery,
        estimated_payback_months: paybackMonths == null ? null : Math.round(paybackMonths * 10) / 10,
        confidence: assumptions.infrastructure.assumption_confidence,
        data_status: 'modeled_scenario',
      }
    })

  const onboardingCases = gameEconomics.map((game) => {
    const cost = assumptions.game_assumptions[game.id].onboarding_cost_usd
    const rampProfit = Math.round(game.monthly_profit_usd * assumptions.onboarding.first_90_day_profit_factor)
    return {
      game_id: game.id,
      game_name: game.name,
      one_time_cost_usd: cost,
      expected_first_90_day_profit_usd: rampProfit,
      expected_net_value_usd: rampProfit - cost,
      estimated_payback_months: game.monthly_profit_usd > 0 ? Math.round((cost / game.monthly_profit_usd) * 10) / 10 : null,
      risk_score: game.risk_score,
      confidence: game.confidence,
      data_status: 'modeled_scenario',
    }
  })

  const totals = gameEconomics.reduce((result, game) => ({
    advertiser_revenue_usd: result.advertiser_revenue_usd + game.advertiser_revenue_usd,
    user_rewards_usd: result.user_rewards_usd + game.user_rewards_usd,
    variable_costs_usd: result.variable_costs_usd + game.variable_costs_usd,
    monthly_profit_usd: result.monthly_profit_usd + game.monthly_profit_usd,
  }), { advertiser_revenue_usd: 0, user_rewards_usd: 0, variable_costs_usd: 0, monthly_profit_usd: 0 })

  return { currency: 'USD', period: 'modeled_month', data_status: 'modeled_scenario', totals, games: gameEconomics, infrastructure_cases: infrastructureCases, onboarding_cases: onboardingCases, methodology: assumptions.methodology }
}
