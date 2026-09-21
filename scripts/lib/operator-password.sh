# Sourced by private operator launchers. Keep secrets on stdin, not process argv.
jco_write_operator_password() {
  [ "$#" -eq 1 ] || return 2
  # readOperatorPassword accepts exact bytes, not a newline-delimited record.
  printf '%s' "$1"
}
