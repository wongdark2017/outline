up:
	docker compose up -d redis postgres
	yarn install-local-ssl
	yarn install --immutable
	yarn dev:watch

build:
	docker compose build --pull outline

test:
	docker compose up -d postgres
	NODE_ENV=test yarn sequelize db:drop
	NODE_ENV=test yarn sequelize db:create
	NODE_ENV=test yarn sequelize db:migrate
	yarn test

watch:
	docker compose up -d redis postgres
	NODE_ENV=test yarn sequelize db:drop
	NODE_ENV=test yarn sequelize db:create
	NODE_ENV=test yarn sequelize db:migrate
	yarn test:watch

destroy:
	docker compose stop
	docker compose rm -f

.PHONY: up build destroy test watch # let's go to reserve rules names

# Develop against Postgres, Redis and file storage shared by the team.
#
# Put the shared settings in .env.shared (git-ignored, never commit it). Every
# developer uses the same values:
#
#   DATABASE_URL=postgres://user:pass@db-host:5432/outline
#   REDIS_URL=redis://:pass@db-host:6379
#   SECRET_KEY=...    # encrypts database columns
#   UTILS_SECRET=...
#   FILE_STORAGE=s3   # e.g. Silo (https://silo.pigsty.io) on db-host
#   AWS_ACCESS_KEY_ID=...
#   AWS_SECRET_ACCESS_KEY=...
#   AWS_REGION=us-east-1
#   AWS_S3_UPLOAD_BUCKET_URL=http://db-host:9000
#   AWS_S3_UPLOAD_BUCKET_NAME=outline
#   AWS_S3_FORCE_PATH_STYLE=true
#
# (FILE_STORAGE=local also works if FILE_STORAGE_LOCAL_ROOT_DIR is a folder
# everyone has mounted from the same network share.)
#
# These values override .env, .env.development and .env.local for the
# commands below only, so `make up` and `make test` keep using local Docker.
# REDIS_COLLABORATION_URL defaults to REDIS_URL so people editing the same
# document see each other's changes live.
#
# Direct connection:  make up-remote
# Through SSH:        make up-remote DB_SERVER=you@db-host
#   (then use 127.0.0.1:$(PG_PORT), 127.0.0.1:$(REDIS_PORT) and
#   http://127.0.0.1:$(S3_PORT) in .env.shared)
#
# The app is started with --no-migrate so a branch with new migrations can't
# change the shared schema by accident. Agree with the team, then run
# `make migrate-remote`.
SHARED_ENV ?= .env.shared
DB_SERVER ?=
PG_PORT ?= 15432
REDIS_PORT ?= 16379
S3_PORT ?= 19000

# Prefix for recipe lines that need the shared settings in their environment.
# WEB_CONCURRENCY=1 keeps a single dev process, which is otherwise only
# enforced when REDIS_COLLABORATION_URL is unset.
with_shared_env = set -a && . $(abspath $(SHARED_ENV)) && set +a && \
	export REDIS_COLLABORATION_URL="$${REDIS_COLLABORATION_URL:-$$REDIS_URL}" \
		WEB_CONCURRENCY="$${WEB_CONCURRENCY:-1}" &&

up-remote: check-shared tunnel
	yarn install-local-ssl
	yarn install --immutable
	$(with_shared_env) OUTLINE_SERVER_ARGS=--no-migrate yarn dev:watch

# Some migrations run compiled scripts from build/server/scripts, so install
# dependencies and build the server first.
migrate-remote: check-shared tunnel
	yarn install --immutable
	yarn build:server
	$(with_shared_env) yarn sequelize db:migrate

check-shared:
	@test -f $(SHARED_ENV) || { echo "Missing $(SHARED_ENV), see the comment above up-remote in the Makefile"; exit 1; }
	@for key in DATABASE_URL REDIS_URL SECRET_KEY FILE_STORAGE; do \
		grep -q "^$$key=" $(SHARED_ENV) || { echo "$(SHARED_ENV) must set $$key"; exit 1; }; \
	done

# Forwards whichever of the three ports isn't open yet, so a leftover tunnel
# for one port (e.g. a manual test) doesn't stop the others being forwarded.
tunnel:
ifneq ($(DB_SERVER),)
	@forwards=""; \
	for pair in $(PG_PORT):5432 $(REDIS_PORT):6379 $(S3_PORT):9000; do \
		nc -z 127.0.0.1 $${pair%%:*} 2>/dev/null || \
			forwards="$$forwards -L $${pair%%:*}:127.0.0.1:$${pair##*:}"; \
	done; \
	test -z "$$forwards" || \
		ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
			$$forwards $(DB_SERVER)
endif

tunnel-stop:
	-pkill -f "$(PG_PORT):127.0.0.1:5432"
	-pkill -f "$(REDIS_PORT):127.0.0.1:6379"
	-pkill -f "$(S3_PORT):127.0.0.1:9000"

.PHONY: up-remote migrate-remote check-shared tunnel tunnel-stop
