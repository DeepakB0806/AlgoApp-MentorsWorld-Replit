CREATE TABLE "app_settings" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"created_at" text,
	"updated_at" text
);
--> statement-breakpoint
CREATE TABLE "broker_configs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" text DEFAULT 'Kotak Neo Credentials',
	"broker_name" text NOT NULL,
	"consumer_key" text,
	"consumer_secret" text,
	"mobile_number" text,
	"ucc" text,
	"mpin" text,
	"environment" text DEFAULT 'prod',
	"is_connected" boolean DEFAULT false NOT NULL,
	"access_token" text,
	"session_id" text,
	"base_url" text,
	"view_token" text,
	"sid_view" text,
	"last_totp_used" text,
	"last_totp_time" text,
	"last_connected" text,
	"connection_error" text,
	"total_logins" integer DEFAULT 0,
	"successful_logins" integer DEFAULT 0,
	"failed_logins" integer DEFAULT 0,
	"last_test_time" text,
	"last_test_result" text,
	"last_test_message" text,
	"total_tests" integer DEFAULT 0,
	"successful_tests" integer DEFAULT 0,
	"created_at" text,
	"updated_at" text
);
--> statement-breakpoint
CREATE TABLE "broker_session_logs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"broker_config_id" varchar(36) NOT NULL,
	"status" text NOT NULL,
	"message" text,
	"error_message" text,
	"totp_used" text,
	"access_token" text,
	"session_id" text,
	"base_url" text,
	"session_expiry" text,
	"login_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broker_test_logs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"broker_config_id" varchar(36) NOT NULL,
	"status" text NOT NULL,
	"message" text,
	"error_message" text,
	"response_time" integer,
	"tested_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broker_field_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"broker_name" text NOT NULL,
	"category" text NOT NULL,
	"field_code" text NOT NULL,
	"field_name" text NOT NULL,
	"field_type" text NOT NULL,
	"field_description" text,
	"direction" text NOT NULL,
	"endpoint" text,
	"universal_field_name" text,
	"match_status" text DEFAULT 'pending' NOT NULL,
	"allowed_values" text,
	"default_value" text,
	"is_required" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"symbol" text NOT NULL,
	"exchange" text DEFAULT 'NSE' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"entry_condition" text,
	"exit_condition" text,
	"stop_loss" real,
	"target_profit" real,
	"total_trades" integer DEFAULT 0,
	"winning_trades" integer DEFAULT 0,
	"profit_loss" real DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "strategy_configs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"webhook_id" varchar(36),
	"exchange" text,
	"ticker" text,
	"indicators" text[],
	"action_mapper" text,
	"uptrend_block" text,
	"downtrend_block" text,
	"neutral_block" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"config_version" integer DEFAULT 1 NOT NULL,
	"created_by" varchar(36),
	"created_at" text,
	"updated_at" text
);
--> statement-breakpoint
CREATE TABLE "strategy_daily_pnl" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"plan_id" varchar(36) NOT NULL,
	"date" text NOT NULL,
	"daily_pnl" real DEFAULT 0,
	"cumulative_pnl" real DEFAULT 0,
	"trades_count" integer DEFAULT 0,
	"open_trades" integer DEFAULT 0,
	"closed_trades" integer DEFAULT 0,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text
);
--> statement-breakpoint
CREATE TABLE "strategy_plans" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config_id" varchar(36) NOT NULL,
	"selected_indicators" text[],
	"trade_params" text,
	"exchange" text,
	"ticker" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"deployment_status" text DEFAULT 'draft' NOT NULL,
	"deployed_config_version" integer,
	"broker_config_id" varchar(36),
	"is_proxy_mode" boolean DEFAULT false,
	"lot_multiplier" integer DEFAULT 1,
	"deploy_stoploss" real,
	"deploy_profit_target" real,
	"created_by" varchar(36),
	"created_at" text,
	"updated_at" text
);
--> statement-breakpoint
CREATE TABLE "strategy_trades" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"plan_id" varchar(36) NOT NULL,
	"order_id" text,
	"trading_symbol" text NOT NULL,
	"exchange" text DEFAULT 'NFO' NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"price" real DEFAULT 0,
	"action" text DEFAULT 'BUY' NOT NULL,
	"block_type" text DEFAULT 'legs' NOT NULL,
	"leg_index" integer DEFAULT 0 NOT NULL,
	"order_type" text,
	"product_type" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"pnl" real DEFAULT 0,
	"ltp" real DEFAULT 0,
	"exit_price" real,
	"exit_action" text,
	"exited_at" text,
	"executed_at" text,
	"created_at" text,
	"updated_at" text,
	"time_unix" bigint,
	"ticker" text,
	"indicator" text,
	"alert" text,
	"local_time" text,
	"mode" text,
	"mode_desc" text
);
--> statement-breakpoint
CREATE TABLE "webhook_data" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"webhook_id" varchar(36) NOT NULL,
	"strategy_id" varchar(36),
	"webhook_name" text,
	"received_at" text NOT NULL,
	"raw_payload" text,
	"time_unix" bigint,
	"exchange" text,
	"indices" text,
	"indicator" text,
	"alert" text,
	"price" real,
	"local_time" text,
	"mode" text,
	"mode_desc" text,
	"first_line" real,
	"mid_line" real,
	"slow_line" real,
	"st" real,
	"ht" real,
	"rsi" real,
	"rsi_scaled" real,
	"alert_system" text,
	"action_binary" integer,
	"lock_state" text,
	"signal_type" text,
	"is_processed" boolean DEFAULT false,
	"processed_at" text
);
--> statement-breakpoint
CREATE TABLE "webhook_logs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"webhook_id" varchar(36) NOT NULL,
	"timestamp" text NOT NULL,
	"payload" text,
	"status" text NOT NULL,
	"response" text,
	"execution_time" integer,
	"ip_address" text,
	"user_agent" text,
	"time_unix" bigint,
	"exchange" text,
	"indices" text,
	"indicator" text,
	"alert" text,
	"price" real,
	"local_time" text,
	"mode" text,
	"mode_desc" text,
	"first_line" real,
	"mid_line" real,
	"slow_line" real,
	"st" real,
	"ht" real,
	"rsi" real,
	"rsi_scaled" real,
	"alert_system" text,
	"action_binary" integer,
	"lock_state" text
);
--> statement-breakpoint
CREATE TABLE "webhook_registry" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"unique_code" varchar(8) NOT NULL,
	"webhook_id" varchar(36),
	"webhook_name" text NOT NULL,
	"created_by" varchar(36),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"notes" text,
	CONSTRAINT "webhook_registry_unique_code_unique" UNIQUE("unique_code")
);
--> statement-breakpoint
CREATE TABLE "webhook_status_logs" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"webhook_id" varchar(36) NOT NULL,
	"test_payload" text,
	"status" text NOT NULL,
	"status_code" integer,
	"response_message" text,
	"error_message" text,
	"response_time" integer,
	"tested_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"unique_code" varchar(8) NOT NULL,
	"name" text NOT NULL,
	"strategy_id" varchar(36),
	"webhook_url" text NOT NULL,
	"secret_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"trigger_type" text NOT NULL,
	"last_triggered" text,
	"total_triggers" integer DEFAULT 0,
	"field_config" text,
	"data_table_name" text,
	"linked_webhook_id" varchar(36),
	"linked_by_webhooks" text[]
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar NOT NULL,
	"role" varchar(50) DEFAULT 'team_member' NOT NULL,
	"invited_by" varchar NOT NULL,
	"token" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"email_sent" boolean DEFAULT false,
	"email_sent_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"role" varchar(50) DEFAULT 'customer' NOT NULL,
	"password" varchar,
	"email_verified" boolean DEFAULT false,
	"email_verification_token" varchar,
	"email_verification_expires" timestamp,
	"totp_enabled" boolean DEFAULT false,
	"totp_secret" varchar,
	"totp_verified" boolean DEFAULT false,
	"backup_codes" text,
	"is_active" boolean DEFAULT true,
	"invited_by" varchar,
	"session_token" varchar,
	"session_expires" timestamp,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "idx_bfm_broker_name" ON "broker_field_mappings" USING btree ("broker_name");--> statement-breakpoint
CREATE INDEX "idx_bfm_broker_category" ON "broker_field_mappings" USING btree ("broker_name","category");--> statement-breakpoint
CREATE INDEX "idx_strategy_configs_webhook_id" ON "strategy_configs" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "idx_strategy_daily_pnl_plan_id" ON "strategy_daily_pnl" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_strategy_daily_pnl_plan_date" ON "strategy_daily_pnl" USING btree ("plan_id","date");--> statement-breakpoint
CREATE INDEX "idx_strategy_plans_config_id" ON "strategy_plans" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "idx_strategy_plans_broker_config_id" ON "strategy_plans" USING btree ("broker_config_id");--> statement-breakpoint
CREATE INDEX "idx_strategy_plans_deployment_status" ON "strategy_plans" USING btree ("deployment_status");--> statement-breakpoint
CREATE INDEX "idx_strategy_trades_plan_id" ON "strategy_trades" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_strategy_trades_status" ON "strategy_trades" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_strategy_trades_plan_status" ON "strategy_trades" USING btree ("plan_id","status");--> statement-breakpoint
CREATE INDEX "idx_webhook_data_webhook_id" ON "webhook_data" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_data_strategy_id" ON "webhook_data" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX "idx_webhook_logs_webhook_id" ON "webhook_logs" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");