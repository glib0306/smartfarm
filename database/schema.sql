-- Seed Farm Smart Integrated Manufacturing System (MES + CPS)
-- One shared database for MES and CPS.  Target: MySQL 5.6+ / MariaDB 10.1+ (XAMPP 3.2.2)
SET NAMES utf8;
SET FOREIGN_KEY_CHECKS = 0;
DROP DATABASE IF EXISTS `smartfarm`;
CREATE DATABASE `smartfarm` DEFAULT CHARACTER SET utf8 COLLATE utf8_general_ci;
USE `smartfarm`;

-- ---------------------------------------------------------------- organisation & authority
CREATE TABLE `departments` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `parent_id` INT NULL,
  `level` TINYINT NOT NULL COMMENT '1 = farm, 2 = division, 3 = team',
  `crop` VARCHAR(10) NULL COMMENT 'rice / wheat / NULL',
  PRIMARY KEY (`id`), KEY (`parent_id`)
) ENGINE=InnoDB;

CREATE TABLE `users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `password_hash` VARCHAR(128) NOT NULL,
  `salt` VARCHAR(32) NOT NULL,
  `full_name` VARCHAR(100) NOT NULL,
  `department_id` INT NOT NULL,
  `role` VARCHAR(20) NOT NULL DEFAULT 'operator' COMMENT 'admin / manager / operator / farmer',
  `approved` TINYINT NOT NULL DEFAULT 0 COMMENT 'login approved by administrator',
  `created_at` DATETIME NULL,
  PRIMARY KEY (`id`), KEY (`department_id`)
) ENGINE=InnoDB;

CREATE TABLE `user_permissions` (
  `user_id` INT NOT NULL,
  `menu_key` VARCHAR(40) NOT NULL,
  PRIMARY KEY (`user_id`, `menu_key`)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- land & crops
CREATE TABLE `cultivars` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `crop` VARCHAR(10) NOT NULL,
  `name` VARCHAR(60) NOT NULL,
  `color` VARCHAR(10) NOT NULL,
  `maturity_days` INT NOT NULL,
  `base_temp` DECIMAL(4,1) NOT NULL,
  `phyllochron` DECIMAL(6,1) NOT NULL COMMENT 'degree-days per leaf',
  `max_leaves` DECIMAL(4,1) NOT NULL,
  `max_tillers` DECIMAL(5,1) NOT NULL,
  `potential_yield` DECIMAL(5,2) NOT NULL COMMENT 't/ha',
  `seed_price` DECIMAL(10,2) NOT NULL COMMENT 'price per t of certified seed',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `fields` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `soil_no` VARCHAR(10) NOT NULL UNIQUE,
  `crop` VARCHAR(10) NOT NULL,
  `cultivar_id` INT NOT NULL,
  `department_id` INT NOT NULL,
  `area_ha` DECIMAL(6,2) NOT NULL,
  `x` INT NOT NULL, `y` INT NOT NULL, `w` INT NOT NULL, `h` INT NOT NULL,
  `grade` TINYINT NOT NULL COMMENT 'land grade 1 (best) .. 5',
  `water_holding_capacity` DECIMAL(6,1) NOT NULL COMMENT 'mm per 1 m of soil',
  `organic_matter` DECIMAL(4,2) NOT NULL COMMENT '%',
  `ph` DECIMAL(3,1) NOT NULL,
  `sowing_date` DATE NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- production planning
CREATE TABLE `process_norms` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `crop` VARCHAR(10) NOT NULL,
  `seq` INT NOT NULL,
  `process` VARCHAR(60) NOT NULL,
  `start_doy` INT NOT NULL,
  `end_doy` INT NOT NULL,
  `labor_manual` DECIMAL(6,2) NOT NULL COMMENT 'man-days / ha, manual work',
  `labor_mech` DECIMAL(6,2) NOT NULL COMMENT 'man-days / ha, mechanised work',
  `machine_h` DECIMAL(6,2) NOT NULL COMMENT 'machine hours / ha when mechanised',
  `equipment_type` VARCHAR(40) NULL,
  `material` VARCHAR(60) NULL,
  `material_per_ha` DECIMAL(8,2) NOT NULL DEFAULT 0,
  `material_unit` VARCHAR(10) NULL,
  `material_price` DECIMAL(10,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `production_plans` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `plan_type` VARCHAR(10) NOT NULL COMMENT 'annual / monthly / fifteen / five',
  `parent_id` INT NULL,
  `department_id` INT NOT NULL,
  `variant_no` INT NOT NULL DEFAULT 1,
  `variant_name` VARCHAR(60) NOT NULL,
  `period_start` DATE NOT NULL,
  `period_end` DATE NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'draft' COMMENT 'draft / submitted (annual, to ERP) / approved',
  `status_by` INT NULL,
  `status_at` DATETIME NULL,
  `mech_ratio` DECIMAL(4,2) NOT NULL DEFAULT 0.5,
  `expected_yield_t` DECIMAL(10,2) NULL,
  `expected_cost` DECIMAL(14,2) NULL,
  `expected_revenue` DECIMAL(14,2) NULL,
  `efficiency` DECIMAL(6,3) NULL,
  `created_at` DATETIME NULL,
  PRIMARY KEY (`id`), KEY (`plan_type`, `department_id`, `period_start`)
) ENGINE=InnoDB;

CREATE TABLE `plan_tasks` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `plan_id` INT NOT NULL,
  `crop` VARCHAR(10) NOT NULL,
  `process` VARCHAR(60) NOT NULL,
  `department_id` INT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `planned_qty` DECIMAL(10,2) NOT NULL COMMENT 'ha',
  `executed_qty` DECIMAL(10,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`), KEY (`plan_id`)
) ENGINE=InnoDB;

CREATE TABLE `plan_resources` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `plan_id` INT NOT NULL,
  `process` VARCHAR(60) NULL,
  `resource_type` VARCHAR(10) NOT NULL COMMENT 'labor / equipment / material',
  `name` VARCHAR(60) NOT NULL,
  `quantity` DECIMAL(12,2) NOT NULL,
  `unit` VARCHAR(12) NOT NULL,
  `cost` DECIMAL(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`), KEY (`plan_id`)
) ENGINE=InnoDB;

CREATE TABLE `erp_submissions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `ref_type` VARCHAR(12) NOT NULL COMMENT 'plan / measure / optimization',
  `ref_id` INT NOT NULL,
  `payload` MEDIUMTEXT NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'submitted' COMMENT 'submitted / cancelled',
  `submitted_by` INT NULL,
  `submitted_at` DATETIME NOT NULL,
  `cancelled_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `daily_reports` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `department_id` INT NOT NULL,
  `farmer_id` INT NOT NULL,
  `report_date` DATE NOT NULL,
  `five_plan_id` INT NULL,
  `plan_qty` DECIMAL(8,2) NOT NULL DEFAULT 0,
  `exec_qty` DECIMAL(8,2) NOT NULL DEFAULT 0,
  `created_by` INT NULL,
  `created_at` DATETIME NULL,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `uq_day_farmer` (`report_date`, `farmer_id`)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- sensors & weather
CREATE TABLE `weather_sensors` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `sensor_no` VARCHAR(20) NOT NULL,
  `location` VARCHAR(80) NOT NULL,
  `x` INT NOT NULL, `y` INT NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `micro_climate` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `sensor_id` INT NOT NULL,
  `measured_at` DATETIME NOT NULL,
  `temperature` DECIMAL(5,2) NOT NULL,
  `humidity` DECIMAL(5,2) NOT NULL,
  `wind_speed` DECIMAL(5,2) NOT NULL,
  `rainfall` DECIMAL(6,2) NOT NULL,
  `solar_radiation` DECIMAL(7,2) NOT NULL,
  PRIMARY KEY (`id`), KEY (`sensor_id`, `measured_at`)
) ENGINE=InnoDB;

CREATE TABLE `weather_daily` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `obs_date` DATE NOT NULL UNIQUE,
  `conditions` VARCHAR(10) NOT NULL COMMENT 'sunny / cloudy / rain / snow',
  `t_max` DECIMAL(5,2) NOT NULL, `t_min` DECIMAL(5,2) NOT NULL, `t_avg` DECIMAL(5,2) NOT NULL,
  `humidity` DECIMAL(5,2) NOT NULL,
  `rainfall` DECIMAL(6,2) NOT NULL,
  `source` VARCHAR(10) NOT NULL DEFAULT 'ACS',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `weather_forecast` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `forecast_date` DATE NOT NULL UNIQUE,
  `conditions` VARCHAR(10) NOT NULL,
  `t_max` DECIMAL(5,2) NOT NULL, `t_min` DECIMAL(5,2) NOT NULL, `t_avg` DECIMAL(5,2) NOT NULL,
  `humidity` DECIMAL(5,2) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `soil_readings` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `field_id` INT NOT NULL,
  `measured_at` DATETIME NOT NULL,
  `water_level_cm` DECIMAL(5,2) NOT NULL,
  `moisture_pct` DECIMAL(5,2) NOT NULL,
  `soil_temp` DECIMAL(5,2) NOT NULL,
  `water_temp` DECIMAL(5,2) NOT NULL,
  PRIMARY KEY (`id`), KEY (`field_id`, `measured_at`)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- growth, nutrition, pests
CREATE TABLE `growth_surveys` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `field_id` INT NOT NULL,
  `survey_date` DATE NOT NULL,
  `days_after_sowing` INT NOT NULL,
  `leaf_number` DECIMAL(5,2) NOT NULL,
  `tiller_number` DECIMAL(5,2) NOT NULL,
  `plant_height` DECIMAL(6,2) NOT NULL,
  `spad` DECIMAL(5,2) NOT NULL,
  `growth_stage` VARCHAR(30) NOT NULL,
  `status` VARCHAR(10) NOT NULL COMMENT 'normal / abnormal / harvest',
  PRIMARY KEY (`id`), KEY (`field_id`, `survey_date`)
) ENGINE=InnoDB;

CREATE TABLE `nutrient_status` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `field_id` INT NOT NULL,
  `diag_date` DATE NOT NULL,
  `n_pct` DECIMAL(5,2) NOT NULL,
  `p_pct` DECIMAL(5,2) NOT NULL,
  `k_pct` DECIMAL(5,2) NOT NULL,
  `spad` DECIMAL(5,2) NOT NULL,
  `status` VARCHAR(20) NOT NULL COMMENT 'sufficient / deficient / excess',
  PRIMARY KEY (`id`), KEY (`field_id`, `diag_date`)
) ENGINE=InnoDB;

CREATE TABLE `pest_catalog` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `crop` VARCHAR(10) NOT NULL,
  `name` VARCHAR(60) NOT NULL,
  `category` VARCHAR(10) NOT NULL,
  `growth_rate` DECIMAL(5,3) NOT NULL COMMENT 'logistic r per day',
  `spread_prob` DECIMAL(5,3) NOT NULL COMMENT 'daily probability of spreading to a neighbour field',
  `optimum_temp` DECIMAL(4,1) NOT NULL,
  `control_measure` VARCHAR(200) NOT NULL,
  `pesticide` VARCHAR(60) NOT NULL,
  `dose_per_ha` DECIMAL(6,2) NOT NULL,
  `dose_unit` VARCHAR(10) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `pests` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `field_id` INT NOT NULL,
  `pest_name` VARCHAR(60) NOT NULL,
  `category` VARCHAR(10) NOT NULL COMMENT 'pest / disease',
  `occurred_on` DATE NOT NULL,
  `location_desc` VARCHAR(80) NULL,
  `image_url` VARCHAR(200) NULL,
  `individuals` INT NOT NULL DEFAULT 0,
  `damaged_area_m2` DECIMAL(10,1) NOT NULL DEFAULT 0,
  `created_by` INT NULL,
  `created_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `technical_measures` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `pest_id` INT NULL,
  `field_id` INT NULL,
  `measure` VARCHAR(200) NOT NULL,
  `labor_md` DECIMAL(8,2) NOT NULL,
  `equipment` VARCHAR(60) NULL,
  `equipment_h` DECIMAL(8,2) NOT NULL DEFAULT 0,
  `material` VARCHAR(60) NULL,
  `material_qty` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `material_unit` VARCHAR(10) NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'draft' COMMENT 'draft / submitted',
  `created_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- power
CREATE TABLE `power_stations` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(60) NOT NULL,
  `type` VARCHAR(20) NOT NULL COMMENT 'substation / transformer / pump / building / dryer',
  `department_id` INT NOT NULL,
  `x` INT NOT NULL, `y` INT NOT NULL,
  `capacity_kw` DECIMAL(8,1) NOT NULL,
  `load_kw` DECIMAL(8,1) NOT NULL,
  `status` VARCHAR(10) NOT NULL DEFAULT 'normal' COMMENT 'normal / fault',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `power_lines` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `from_station` INT NOT NULL,
  `to_station` INT NOT NULL,
  `voltage_kv` DECIMAL(5,2) NOT NULL,
  `status` VARCHAR(10) NOT NULL DEFAULT 'normal',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `power_consumption` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `station_id` INT NOT NULL,
  `department_id` INT NOT NULL,
  `reading_date` DATE NOT NULL,
  `kwh` DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (`id`), KEY (`reading_date`), KEY (`department_id`)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- equipment & irrigation
CREATE TABLE `equipment` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `designation` VARCHAR(60) NOT NULL,
  `equipment_no` VARCHAR(20) NOT NULL,
  `type` VARCHAR(30) NOT NULL,
  `department_id` INT NOT NULL,
  `status` VARCHAR(12) NOT NULL COMMENT 'operating / idle / repair',
  `range_desc` VARCHAR(60) NULL COMMENT 'working range (assigned fields)',
  `reason` VARCHAR(120) NULL COMMENT 'reason for not operating',
  `x` INT NOT NULL, `y` INT NOT NULL,
  `hourly_cost` DECIMAL(8,2) NOT NULL DEFAULT 0,
  `updated_at` DATETIME NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `irrigation_pumps` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(40) NOT NULL,
  `x` INT NOT NULL, `y` INT NOT NULL,
  `status` VARCHAR(10) NOT NULL COMMENT 'running / stopped / fault',
  `flow_m3h` DECIMAL(8,1) NOT NULL,
  `power_kw` DECIMAL(6,1) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `irrigation_canals` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(40) NOT NULL,
  `canal_type` VARCHAR(10) NOT NULL COMMENT 'main / branch / drain',
  `pump_id` INT NULL,
  `points` TEXT NOT NULL COMMENT 'x,y;x,y;...',
  `capacity_m3h` DECIMAL(8,1) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `attendance` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `att_date` DATE NOT NULL,
  `kind` VARCHAR(10) NOT NULL COMMENT 'operator / visitor',
  `user_id` INT NULL,
  `visitor_name` VARCHAR(60) NULL,
  `field_id` INT NULL,
  PRIMARY KEY (`id`), KEY (`att_date`)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- analytics
CREATE TABLE `yield_history` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `field_id` INT NOT NULL,
  `year` INT NOT NULL,
  `crop` VARCHAR(10) NOT NULL,
  `cultivar_id` INT NOT NULL,
  `n_applied` DECIMAL(6,1) NOT NULL COMMENT 'kg N / ha',
  `avg_temp` DECIMAL(5,2) NOT NULL,
  `rainfall` DECIMAL(7,1) NOT NULL,
  `max_tillers` DECIMAL(5,2) NOT NULL,
  `spad` DECIMAL(5,2) NOT NULL,
  `yield_t_ha` DECIMAL(5,2) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `model_params` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `model` VARCHAR(30) NOT NULL COMMENT 'growth / bpnn_yield / pls_fertility',
  `cultivar_id` INT NULL,
  `params` MEDIUMTEXT NOT NULL,
  `samples` INT NOT NULL DEFAULT 0,
  `rmse` DECIMAL(10,4) NULL,
  `trained_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`), KEY (`model`, `cultivar_id`)
) ENGINE=InnoDB;

CREATE TABLE `edit_requests` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `table_name` VARCHAR(40) NOT NULL,
  `record_id` INT NOT NULL,
  `payload` TEXT NOT NULL,
  `requested_by` INT NOT NULL,
  `owner_id` INT NULL COMMENT 'person who originally entered the data',
  `owner_approved` TINYINT NOT NULL DEFAULT 0,
  `manager_approved` TINYINT NOT NULL DEFAULT 0,
  `status` VARCHAR(10) NOT NULL DEFAULT 'pending' COMMENT 'pending / applied / rejected',
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `prices` (
  `item` VARCHAR(40) NOT NULL,
  `value` DECIMAL(12,2) NOT NULL,
  `unit` VARCHAR(20) NOT NULL,
  PRIMARY KEY (`item`)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- harvest & machinery map
CREATE TABLE `crop_types` (
  `code` VARCHAR(10) NOT NULL COMMENT 'matches fields.crop / cultivars.crop',
  `name` VARCHAR(40) NOT NULL,
  `family` VARCHAR(30) NOT NULL,
  `color` VARCHAR(10) NOT NULL,
  `harvest_moisture_max` DECIMAL(4,1) NOT NULL COMMENT 'grain moisture % at which harvest may start',
  `harvest_moisture_min` DECIMAL(4,1) NOT NULL COMMENT 'below this, shattering losses rise',
  `storage_moisture` DECIMAL(4,1) NOT NULL COMMENT 'safe storage moisture %',
  `typical_yield_t_ha` DECIMAL(5,2) NOT NULL,
  `harvest_machine_type` VARCHAR(30) NOT NULL,
  `planted` TINYINT NOT NULL DEFAULT 0 COMMENT '1 = grown on this farm',
  PRIMARY KEY (`code`)
) ENGINE=InnoDB;

CREATE TABLE `machine_types` (
  `type` VARCHAR(30) NOT NULL COMMENT 'matches equipment.type',
  `code` VARCHAR(4) NOT NULL COMMENT 'short map label',
  `category` VARCHAR(20) NOT NULL COMMENT 'tillage / planting / crop care / harvest / transport / post-harvest / irrigation',
  `operation` VARCHAR(80) NOT NULL,
  `crops` VARCHAR(40) NOT NULL,
  `mobile` TINYINT NOT NULL DEFAULT 1 COMMENT '0 = stationary plant, not routed',
  `tracked` TINYINT NOT NULL DEFAULT 0 COMMENT 'crawler tracks cope better with mud',
  `width_m` DECIMAL(4,2) NOT NULL COMMENT 'transport width',
  `weight_t` DECIMAL(5,2) NOT NULL COMMENT 'operating weight incl. load',
  `road_speed_kmh` DECIMAL(4,1) NOT NULL,
  `field_speed_kmh` DECIMAL(4,1) NOT NULL,
  `work_rate_ha_h` DECIMAL(5,2) NOT NULL,
  `fuel_l_h` DECIMAL(5,1) NOT NULL,
  `color` VARCHAR(10) NOT NULL,
  PRIMARY KEY (`type`)
) ENGINE=InnoDB;

CREATE TABLE `road_nodes` (
  `id` INT NOT NULL,
  `name` VARCHAR(40) NULL,
  `kind` VARCHAR(12) NOT NULL COMMENT 'junction / facility / gate',
  `x` INT NOT NULL, `y` INT NOT NULL COMMENT 'farm map units (1 unit = 2 m)',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `road_edges` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `from_node` INT NOT NULL,
  `to_node` INT NOT NULL,
  `name` VARCHAR(40) NOT NULL,
  `road_class` VARCHAR(12) NOT NULL COMMENT 'main / headland / farm / service / lane',
  `surface` VARCHAR(10) NOT NULL COMMENT 'concrete / gravel / earth',
  `width_m` DECIMAL(4,1) NOT NULL,
  `max_weight_t` DECIMAL(5,1) NOT NULL,
  `speed_limit_kmh` DECIMAL(4,1) NOT NULL,
  `road_state` VARCHAR(8) NOT NULL DEFAULT 'good' COMMENT 'good / rutted / muddy / closed',
  `note` VARCHAR(80) NULL,
  PRIMARY KEY (`id`), KEY (`from_node`), KEY (`to_node`)
) ENGINE=InnoDB;

CREATE TABLE `harvest_conditions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `field_id` INT NOT NULL,
  `assessed_on` DATE NOT NULL,
  `maturity_pct` DECIMAL(5,1) NOT NULL,
  `grain_moisture_pct` DECIMAL(4,1) NULL COMMENT 'NULL before grain fill',
  `lodging_pct` DECIMAL(4,1) NOT NULL DEFAULT 0,
  `expected_yield_t_ha` DECIMAL(5,2) NOT NULL,
  `harvested_pct` DECIMAL(5,1) NOT NULL DEFAULT 0,
  `readiness` VARCHAR(12) NOT NULL COMMENT 'growing / approaching / ready / harvesting / harvested',
  `est_harvest_date` DATE NULL,
  `notes` VARCHAR(120) NULL,
  PRIMARY KEY (`id`), UNIQUE KEY (`field_id`, `assessed_on`)
) ENGINE=InnoDB;

CREATE TABLE `machine_telemetry` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `equipment_id` INT NOT NULL,
  `recorded_at` DATETIME NOT NULL,
  `x` DECIMAL(7,1) NOT NULL, `y` DECIMAL(7,1) NOT NULL,
  `heading` SMALLINT NOT NULL DEFAULT 0 COMMENT 'degrees, 0 = north',
  `speed_kmh` DECIMAL(4,1) NOT NULL DEFAULT 0,
  `fuel_pct` DECIMAL(4,1) NOT NULL,
  `engine_hours` DECIMAL(8,1) NOT NULL,
  `status` VARCHAR(12) NOT NULL COMMENT 'operating / idle / repair',
  `field_id` INT NULL,
  `task` VARCHAR(60) NULL,
  `source` VARCHAR(4) NOT NULL DEFAULT 'sim' COMMENT 'gps = received from a machine terminal',
  PRIMARY KEY (`id`), KEY (`equipment_id`, `recorded_at`)
) ENGINE=InnoDB;
