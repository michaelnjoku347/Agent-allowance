def select_resource(task, catalog):
    """Temporary keyword selector. No AI calls or payments."""
    task = task.strip().lower()

    if not task:
        return {
            "resource": None,
            "reason": "Please provide a task.",
        }

    matches = [
        resource
        for resource in catalog
        if any(keyword.lower() in task for keyword in resource["keywords"])
    ]

    if not matches:
        return {
            "resource": None,
            "reason": "No matching resource is available.",
        }

    if len(matches) > 1:
        return {
            "resource": None,
            "reason": "Multiple resources match. Please clarify the task.",
        }

    return {
        "resource": matches[0],
        "reason": "Selected using demo keyword matching.",
    }