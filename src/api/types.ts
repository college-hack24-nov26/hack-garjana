/** TypeScript mirrors of the backend Pydantic contracts.
 *
 * Numbers are canonical SI unless the field name or a `DisplayValue` says
 * otherwise. Anything optional is optional because the backend genuinely may
 * not have computed it, and the UI must render that as "not available" rather
 * than as a zero. */

export type ComponentType = 'alloy_wheel' | 'brake_caliper' | 'spark_plug';
export type DesignMode = 'improve_existing' | 'generate_new';
export type AnalysisType =
  | 'linear_static_structural'
  | 'steady_state_thermal'
  | 'reduced_order_thermal';

export type CandidateStatus =
  | 'pending'
  | 'geometry_valid'
  | 'geometry_invalid'
  | 'meshed'
  | 'mesh_failed'
  | 'solved'
  | 'solver_failed'
  | 'feasible'
  | 'infeasible';

export type SourceStatus =
  | 'user_supplied'
  | 'official_problem_statement'
  | 'supplier_certified'
  | 'illustrative_handbook_value'
  | 'demo_fixture'
  | 'llm_draft_unconfirmed';

export interface DisplayValue {
  value: number;
  unit: string;
  canonical_value: number;
  canonical_unit: string;
}

export interface Assumption {
  key: string;
  statement: string;
  source_status: SourceStatus;
  source_reference?: string | null;
  requires_confirmation: boolean;
  confirmed: boolean;
}

export interface MissingField {
  field: string;
  label: string;
  expected_kind: string;
  why_required: string;
  suggested_unit?: string | null;
}

/* ------------------------------------------------------------- profiles */

export interface ParameterSpec {
  name: string;
  label: string;
  kind: 'continuous' | 'integer';
  unit: string;
  minimum: number;
  maximum: number;
  default: number;
  step?: number | null;
  description?: string | null;
  is_design_variable: boolean;
  preserved_reason?: string | null;
}

export interface EngineeringInput {
  key: string;
  label: string;
  kind: string;
  unit: string;
  required: boolean;
  demo_default?: number | null;
  demo_default_display?: number | null;
  help_text: string;
  why_required: string;
}

export interface Material {
  material_id: string;
  name: string;
  family: string;
  typical_use?: string | null;
  density: number;
  elastic_modulus?: number | null;
  poisson_ratio?: number | null;
  yield_strength?: number | null;
  thermal_conductivity?: number | null;
  specific_heat?: number | null;
  max_service_temperature?: number | null;
  source_status: string;
  notes?: string | null;
  supports_structural: boolean;
  supports_thermal: boolean;
  supports_yield_margin: boolean;
}

export interface MeshPresetInfo {
  key: string;
  label: string;
  description: string;
  element_size_scale: number;
  target_element_size_mm: number;
}

export interface ObjectiveSpec {
  objective_id: string;
  metric: string;
  sense: 'minimize' | 'maximize';
  weight?: number;
  label?: string | null;
}

export interface Profile {
  component_type: ComponentType;
  display_name: string;
  summary: string;
  analysis_type: AnalysisType;
  solver_id: string;
  solver_name: string;
  result_kind: string;
  method_statement: string;
  scope_statement: string;
  not_in_scope: string[];
  capability_note: string;
  parameters: ParameterSpec[];
  design_variables: string[];
  engineering_inputs: EngineeringInput[];
  materials: Material[];
  material_assignments: Record<string, string>;
  /** Objectives this profile can optimise, in its own default order. */
  objectives: ObjectiveSpec[];
  region_names: string[];
  demo_assumptions: Assumption[];
  mesh_presets: MeshPresetInfo[];
}

/* ------------------------------------------------- projects & components */

export interface Project {
  id: string;
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
  component_count: number;
  design_count: number;
  job_count: number;
}

export interface ComponentInstance {
  id: string;
  project_id: string;
  component_type: ComponentType;
  design_mode: DesignMode;
  name: string;
  unit_system: string;
  source_asset_path?: string | null;
  source_metadata?: Record<string, unknown> | null;
  source_is_parametric: boolean;
  created_at: string;
}

/* -------------------------------------------------------------- studies */

export interface StudyRequest {
  component_instance_id: string;
  material_id: string;
  objective_summary: string;
  engineering_inputs: Record<string, number>;
  parameters: Record<string, number>;
  design_variables: string[];
  /** Objective ids to optimise, most important first. */
  objectives: string[];
  strategy: 'doe' | 'nsga2';
  candidate_budget: number;
  population_size: number;
  generations: number;
  mesh_preset: 'screening' | 'exploration' | 'verification';
  verify_winner: boolean;
  random_seed: number;
  time_budget_seconds?: number | null;
  confirm_demo_assumptions: boolean;
}

export interface ValidationResponse {
  ok: boolean;
  message: string;
  missing_fields: MissingField[];
  errors: string[];
  unconfirmed_assumptions: Assumption[];
}

export interface JobAccepted {
  job_id: string;
  status: string;
  deduplicated: boolean;
  poll_url: string;
}

export interface Job {
  id: string;
  job_type: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  stage: string;
  progress: number;
  message?: string | null;
  error?: string | null;
  project_id?: string | null;
  component_instance_id?: string | null;
  optimization_run_id?: string | null;
  stage_history: Array<{ stage: string; at: string }>;
  result_payload?: Record<string, unknown> | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  log_available: boolean;
}

export interface ConstraintResult {
  constraint_id: string;
  metric: string;
  label?: string | null;
  operator: string;
  description: string;
  source_status: SourceStatus;
  source_reference?: string | null;
  value?: DisplayValue | null;
  limit?: DisplayValue | null;
  lower?: DisplayValue | null;
  upper?: DisplayValue | null;
  /** null means the metric was not produced, so there is no verdict. */
  passed?: boolean | null;
  margin_fraction?: number | null;
  note?: string | null;
}

export interface ObjectiveValue {
  objective_id: string;
  metric: string;
  sense: 'minimize' | 'maximize';
  label?: string | null;
  value?: DisplayValue | null;
  normalized_cost?: number | null;
}

/* ------------------------------------------------- assurance and maturity */

/** Five states, because "it ran" and "it is right" are different facts.
 *
 *  `not_run` and `warning` are not passes and must never be rendered as one.
 *  `not_applicable` is the only non-pass that does not count against a result:
 *  a structural run genuinely has no thermal boundary to get wrong. */
export type CheckStatus =
  | 'passed'
  | 'failed'
  | 'warning'
  | 'not_run'
  | 'not_applicable';

export interface AssuranceCheck {
  check_id: string;
  stage: 'pre_solver' | 'post_solver';
  title: string;
  description: string;
  status: CheckStatus;
  severity: 'blocking' | 'advisory';
  measured?: number | null;
  threshold?: number | null;
  unit?: string | null;
  detail: string;
}

export interface AssuranceReport {
  stage: 'pre_solver' | 'post_solver';
  checks: AssuranceCheck[];
}

export type MaturityLevel =
  | 'virtual_prototype'
  | 'simulation_evaluated'
  | 'numerically_verified'
  | 'experimentally_validated'
  | 'calibrated_component_twin'
  | 'operational_predictive_twin';

export interface MaturityAssessment {
  level: MaturityLevel;
  level_ordinal: number;
  label: string;
  basis: string[];
  blocked_from?: MaturityLevel | null;
  blocking_reasons: string[];
  evidence_requirement: string;
  prohibited_claims: string[];
  intended_use_domain: string;
  last_evidence_date?: string | null;
  unresolved_limitations: string[];
  derivation: string;
}

export interface VerificationRecord {
  status: 'verified' | 'unverified' | 'failed';
  benchmark_id?: string | null;
  pre_solver: AssuranceReport;
  post_solver?: AssuranceReport | null;
  unit_check_passed?: boolean | null;
  geometry_integrity_passed?: boolean | null;
  interface_invariance_passed?: boolean | null;
  region_mapping_passed?: boolean | null;
  mesh_quality_passed?: boolean | null;
  load_balance_passed?: boolean | null;
  energy_balance_passed?: boolean | null;
  benchmark_passed?: boolean | null;
  mesh_convergence_passed?: boolean | null;
  mesh_convergence_status?: MeshConvergenceStatus;
  reaction_balance_error?: number | null;
  energy_balance_error?: number | null;
  warnings: string[];
  blocking_failures: string[];
  evidence_gaps: string[];
}

export interface ValidationRecord {
  status: 'passed' | 'failed' | 'calibration_only' | 'not_run' | 'not_available';
  dataset_id?: string | null;
  measurement_basis?: string | null;
  statement: string;
}

export interface UncertaintyRecord {
  numerical_error_sources: string[];
  solver_residual?: number | null;
  discretization_sensitivity?: number | null;
  model_discrepancy?: number | null;
  measurement_uncertainty?: number | null;
  note: string;
}

export interface ProvenanceEntry {
  key: string;
  label: string;
  value?: number | null;
  unit: string;
  source_type:
    | 'user_supplied'
    | 'measured'
    | 'approved_database'
    | 'literature'
    | 'demo_assumption'
    | 'derived';
  source_id?: string | null;
  source_reference?: string | null;
  revision?: string | null;
  confirmed: boolean;
  uncertainty?: number | null;
  note?: string | null;
}

export interface EvidenceRecord {
  requirement_revision?: string | null;
  geometry_hash?: string | null;
  material_snapshot_hash?: string | null;
  load_case_hash?: string | null;
  mesh_hash?: string | null;
  solver_input_hash?: string | null;
  solver_name?: string | null;
  solver_version?: string | null;
  generator_version?: string | null;
  code_commit?: string | null;
  recorded_at: string;
  provenance: ProvenanceEntry[];
}

export interface AssuranceOutcome {
  verification: VerificationRecord;
  validation: ValidationRecord;
  uncertainty: UncertaintyRecord;
  maturity: MaturityAssessment;
  evidence?: EvidenceRecord | null;
  ladder_level?: string | null;
  ladder_release_label?: string | null;
  ladder_next_gap?: string | null;
  fidelity_level?: string | null;
}

export interface LadderRung {
  level: string;
  capability: string;
  evidence_required: string;
  release_label: string;
  attained: boolean;
  gap?: string | null;
}

export interface ValidationLadder {
  component_type: ComponentType;
  title: string;
  attained_level: string;
  rungs: LadderRung[];
}

export interface FidelityRung {
  level: string;
  method: string;
  use: string;
  gate: string;
  available: boolean;
}

export interface AssuranceCapabilities {
  maturity_levels: Array<{
    level: MaturityLevel;
    ordinal: number;
    label: string;
    evidence_required: string;
    prohibited_claims: string[];
  }>;
  attained_maturity: MaturityLevel;
  attained_maturity_note: string;
  /** What each of the four recorded convergence states means, served by the
   *  backend so the UI and the report cannot drift apart on the wording. */
  mesh_convergence_states?: Record<MeshConvergenceStatus, string>;
  validation_ladders: ValidationLadder[];
  fidelity_ladder: FidelityRung[];
  prohibited_claims: string[];
}

export interface Candidate {
  candidate_id: string;
  index: number;
  generation: number;
  status: CandidateStatus;
  is_baseline: boolean;
  from_cache: boolean;
  parameters: Record<string, number>;
  geometry_hash: string;
  metrics: Record<string, number>;
  display_metrics: Record<string, DisplayValue>;
  constraint_results: ConstraintResult[];
  objective_values: ObjectiveValue[];
  is_feasible?: boolean | null;
  infeasibility_reasons: string[];
  failure_stage?: string | null;
  failure_reason?: string | null;
  rank?: number | null;
  pareto_front?: number | null;
  evaluated: boolean;
  design_version_id?: string | null;
  preview_url?: string | null;
  step_url?: string | null;
  fields_url?: string | null;
  solve_time_seconds?: number | null;
  mesh_node_count?: number | null;
  warnings: string[];
  /** What the deterministic assurance plane concluded. `null` means the gate
   *  did not run for this candidate, which the UI shows as such. */
  assurance?: AssuranceOutcome | null;
}

export interface Recommendation {
  candidate_id?: string | null;
  improves_on_baseline?: boolean | null;
  primary_metric?: string | null;
  baseline_value?: number | null;
  candidate_value?: number | null;
  percent_change?: number | null;
  statement: string;
}

export interface ComparisonEntry {
  available: boolean;
  baseline?: DisplayValue;
  candidate?: DisplayValue;
  absolute_change?: number;
  percent_change?: number | null;
}

export interface MeshConvergence {
  performed: boolean;
  coarse_preset: string;
  fine_preset: string;
  coarse_nodes?: number | null;
  fine_nodes?: number | null;
  metrics: Record<
    string,
    {
      available: boolean;
      coarse?: number;
      fine?: number;
      relative_change?: number;
      percent_change?: number;
      converged?: boolean;
    }
  >;
  converged?: boolean | null;
  tolerance: number;
  statement: string;
  coarse_feasible?: boolean | null;
  fine_feasible?: boolean | null;
  verdict_changed?: boolean | null;
  unconverged_metrics: string[];
  /** Four states, not two. `inconclusive` means the decision quantity
   *  converged but a region-specific metric did not — a singular peak
   *  gradient at a material interface never converges at any mesh density,
   *  so it is reported rather than treated as a failure. */
  status?: MeshConvergenceStatus;
  decision_metric?: string | null;
  decision_metric_converged?: boolean | null;
  decision_metric_change?: number | null;
  unconverged_region_metrics?: string[];
}

export type MeshConvergenceStatus =
  | 'not_run'
  | 'passed'
  | 'failed'
  | 'inconclusive';

export interface StudySummary {
  candidates_generated: number;
  candidates_evaluated: number;
  candidates_feasible: number;
  candidates_failed: number;
  cache_hits: number;
  total_seconds?: number | null;
  mean_solve_seconds?: number | null;
  max_solve_seconds?: number | null;
}

export interface StudyResult {
  optimization_run_id: string;
  component_instance_id: string;
  component_type: ComponentType;
  analysis_type: AnalysisType;
  algorithm: string;
  random_seed: number;
  status: string;
  /** When the solver finished. Used to mark a stored result from an earlier
   *  run, so a demo falling back to one cannot read as a live computation. */
  started_at?: string | null;
  completed_at?: string | null;
  solver_name: string;
  solver_version: string;
  method_statement: string;
  mesh_preset: string;
  summary: StudySummary;
  termination_reason: string;
  candidates: Candidate[];
  baseline_candidate_id?: string | null;
  recommended_candidate_id?: string | null;
  recommendation?: Recommendation | null;
  comparison: Record<string, ComparisonEntry>;
  mesh_convergence: MeshConvergence;
  objectives: Array<Record<string, unknown>>;
  constraints: Array<Record<string, unknown>>;
  assumptions: Assumption[];
  specification: Record<string, unknown>;
  warnings: string[];
}

/* -------------------------------------------------------- visualization */

export interface VisualizationPayload {
  candidate_id: string;
  result_kind: string;
  analysis_type: string;
  geometry_asset_url?: string | null;
  node_count: number;
  triangle_count: number;
  nodes: number[][];
  faces: number[][];
  displacement?: number[][] | null;
  von_mises?: number[] | null;
  temperature?: number[] | null;
  stress_location?: string | null;
  temperature_location?: string | null;
  stress_range_pa?: [number, number] | null;
  temperature_range_k?: [number, number] | null;
  displacement_range_m?: [number, number] | null;
  recommended_deformation_scale: number;
  max_displacement_m?: number | null;
  visualization_note: string;
  method_statement: string;
}

/* ------------------------------------------------------------ assistant */

export interface ExtractedValue {
  key: string;
  value_canonical: number;
  canonical_unit: string;
  display_value: number;
  display_unit: string;
  source_text: string;
  confidence: 'explicit' | 'inferred';
}

export interface RequirementDraft {
  interpreted: boolean;
  parser: string;
  component_type?: ComponentType | null;
  design_mode: DesignMode;
  analysis_type?: AnalysisType | null;
  objective_summary: string;
  material_id?: string | null;
  material_candidates: string[];
  engineering_inputs: Record<string, number>;
  extracted_values: ExtractedValue[];
  objectives: string[];
  design_variables: string[];
  missing_fields: MissingField[];
  assumptions_requiring_confirmation: Assumption[];
  warnings: string[];
  notes: string[];
}

export interface GroundedFact {
  label: string;
  metric: string;
  value: number;
  unit: string;
  canonical_value: number;
  canonical_unit: string;
  source: string;
}

export interface Explanation {
  generator: string;
  headline: string;
  paragraphs: string[];
  grounded_facts: GroundedFact[];
  constraint_statements: string[];
  caveats: string[];
  method_statement: string;
}

/* ----------------------------------------------------------------- cost */

export interface CostInputs {
  currency: string;
  prototype_unit_cost: number;
  physical_test_cost: number;
  engineering_hourly_cost: number;
  traditional_physical_iterations: number;
  traditional_engineering_hours_per_iteration: number;
  physical_iterations_after_virtual: number;
  virtual_engineering_hours: number;
  virtual_compute_cost: number;
  lead_time_days_per_physical_iteration?: number | null;
  lead_time_days_per_virtual_study?: number | null;
}

export interface CostLine {
  label: string;
  amount: number;
  formula: string;
}

export interface CostEstimate {
  currency: string;
  inputs: CostInputs;
  traditional_cost: number;
  virtual_first_cost: number;
  estimated_savings: number;
  estimated_savings_percent?: number | null;
  traditional_breakdown: CostLine[];
  virtual_breakdown: CostLine[];
  physical_iterations_avoided: number;
  traditional_lead_time_days?: number | null;
  virtual_first_lead_time_days?: number | null;
  lead_time_days_saved?: number | null;
  disclaimer: string;
  assumptions: string[];
}

/* --------------------------------------------------------- capabilities */

export interface BenchmarkQuantity {
  computed: number;
  reference: number;
  unit: string;
  relative_error: number;
  tolerance: number;
  reference_basis: string;
  passed: boolean;
}

export interface Benchmark {
  name: string;
  description: string;
  reference_source: string;
  passed: boolean;
  quantities: Record<string, BenchmarkQuantity>;
  notes: string[];
}

export interface Capabilities {
  solvers: {
    in_process_solvers: Array<{
      solver_id: string;
      name: string;
      version: string;
      analysis_type: string;
      result_kind: string;
      method_statement: string;
      verified_by_benchmark: boolean;
    }>;
    external_solvers: Record<
      string,
      { configured: boolean; available: boolean; note: string }
    >;
  };
  cad_kernel: string;
  mesher: string;
  optimizers: string[];
  limits: Record<string, number>;
  standing_limitations: string[];
  benchmarks?: Benchmark[];
  benchmarks_all_passed?: boolean;
  assurance?: AssuranceCapabilities;
}

/* ------------------------------------------------- reduced-order estimate */

export interface EstimatedMetric {
  key: string;
  label: string;
  value: number;
  display_value: number;
  display_unit: string;
  model: string;
  confidence: 'indicative' | 'trend_only';
}

export interface EstimateResult {
  component_type: ComponentType;
  fidelity: string;
  metrics: EstimatedMetric[];
  assumptions: string[];
  calibration_note: string;
  is_estimate: boolean;
  disclaimer: string;
}

export interface EstimateRequest {
  component_type: ComponentType;
  parameters: Record<string, number>;
  engineering_inputs: Record<string, number>;
  material_id?: string | null;
  material_assignments: Record<string, string>;
}
