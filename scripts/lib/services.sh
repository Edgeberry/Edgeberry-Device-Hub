# Canonical list of Edgeberry Device Hub systemd units.
#
# Every install/uninstall/deploy script needs to stop, enable, start, or
# remove "all the services" - this used to be a hand-copied list in each
# script, and it silently drifted: devicehub-application.service was added
# later and got left out of enable_services() (so it never survived a
# reboot) and out of uninstall.sh (so it was never stopped or removed).
# Source this file instead of copying the list again.

# The four Device Hub Node.js services proper - same start/stop/enable
# lifecycle for all of them.
DEVICEHUB_SERVICE_UNITS=(
  devicehub-core.service
  devicehub-provisioning.service
  devicehub-twin.service
  devicehub-application.service
)

# Certificate-lifecycle automation: path unit + the oneshot service it
# triggers, one pair per concern. Kept separate from
# DEVICEHUB_SERVICE_UNITS because callers generally enable+start these
# rather than restart them, and because uninstall.sh removes them via the
# same list.
DEVICEHUB_AUX_UNITS=(
  edgeberry-ca-rehash.service
  edgeberry-ca-rehash.path
  edgeberry-cert-sync.service
  edgeberry-cert-sync.path
)
