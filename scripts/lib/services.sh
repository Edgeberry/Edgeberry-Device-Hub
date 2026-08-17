# Canonical list of Edgeberry Device Hub systemd units.
#
# The Hub runs as a single process/unit; this is an array rather than a
# bare string so install/uninstall/deploy all iterate one shared list, and
# so adding a second unit later means editing this file only.
DEVICEHUB_SERVICE_UNITS=(
  devicehub.service
)

# Units from the previous 4-process layout (core/provisioning/twin/
# application) plus the certificate path-watcher units they relied on.
# Nothing installs these anymore - the merged service handles all of it
# in-process (see src/certs.ts syncCertsToMosquitto) - but install and
# uninstall both need to stop, disable, and remove them so upgrading from
# an older release doesn't leave orphaned units running against the same
# database and MQTT topics.
DEVICEHUB_LEGACY_UNITS=(
  devicehub-core.service
  devicehub-provisioning.service
  devicehub-twin.service
  devicehub-application.service
  edgeberry-ca-rehash.service
  edgeberry-ca-rehash.path
  edgeberry-cert-sync.service
  edgeberry-cert-sync.path
)
