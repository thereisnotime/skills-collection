"""config_merge -- recursively merge an override config onto a base config.

Known issue (see spec): deep_merge() MUTATES the caller's `base` dict in place
(and shares nested references), so a caller who merges two configs finds their
original base silently changed. Fix it to be pure: return a new merged dict and
leave both inputs untouched.
"""


def deep_merge(base, override):
    """Recursively merge `override` onto `base`. Returns the merged mapping.

    For overlapping keys whose values are both dicts, merge recursively;
    otherwise the override value wins.
    """
    for key, value in override.items():
        if key in base and isinstance(base[key], dict) and isinstance(value, dict):
            deep_merge(base[key], value)
        else:
            base[key] = value
    return base
