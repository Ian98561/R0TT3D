FROM postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24
COPY --chmod=0555 init-synapse-db.sh /docker-entrypoint-initdb.d/10-create-synapse-db.sh
