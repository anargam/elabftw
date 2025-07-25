/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2012 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */
import {
  mkSpin,
  mkSpinStop,
  permissionsToJson,
  reloadElements,
  TomSelect,
  updateCatStat,
} from './misc';
import $ from 'jquery';
import { Malle } from '@deltablot/malle';
import i18next from './i18n';
import { getEditor } from './Editor.class';
import { Api } from './Apiv2.class';
import { EntityType, Model, Action, Selected } from './interfaces';
import tinymce from 'tinymce/tinymce';
import { Notification } from './Notifications.class';
import Tab from './Tab.class';

function collectSelectable(name: string): number[] {
  const collected = [];
  document.querySelectorAll(`#batchActions input[name=${name}]`).forEach(input => {
    const box = input as HTMLInputElement;
    if (box.checked) {
      collected.push(parseInt((input as HTMLInputElement).value, 10));
    }
  });
  return collected;
}

function collectTargetOwner(): number {
  const collected = document.getElementById('target_owner') as HTMLInputElement;
  // Convert element to an int
  return collected ? parseInt(collected.value, 10) || 0 : 0;
}

function collectCan(): string {
  // Warning: copy pasta from common.ts save-permissions action
  // collect existing users listed in ul->li, and store them in a string[] with user:<userid>
  const existingUsers = Array.from(document.getElementById('masscan_list_users').children)
    .map(u => `user:${(u as HTMLElement).dataset.id}`);

  return permissionsToJson(
    parseInt(((document.getElementById('masscan_select_base') as HTMLSelectElement).value), 10),
    Array.from((document.getElementById('masscan_select_teams') as HTMLSelectElement).selectedOptions).map(v=>v.value)
      .concat(Array.from((document.getElementById('masscan_select_teamgroups') as HTMLSelectElement).selectedOptions).map(v=>v.value))
      .concat(existingUsers),
  );

}
function getSelected(): Selected {
  return {
    items_types: collectSelectable('items_types'),
    items_status: collectSelectable('items_status'),
    items_tags: collectSelectable('items_tags'),
    experiments_status: collectSelectable('experiments_status'),
    experiments_categories: collectSelectable('experiments_categories'),
    experiments_tags: collectSelectable('experiments_tags'),
    tags: collectSelectable('tags'),
    users: collectSelectable('users'),
    target_owner: collectTargetOwner(),
    can: collectCan(),
  };
}


if (window.location.pathname === '/admin.php') {

  const ApiC = new Api();
  const notify = new Notification();
  const TabMenu = new Tab();
  TabMenu.init(document.querySelector('.tabbed-menu'));

  const editor = getEditor();
  editor.init('admin');

  // edit the team group name
  const malleableGroupname = new Malle({
    cancel : i18next.t('cancel'),
    cancelClasses: ['button', 'btn', 'btn-danger', 'mt-2'],
    inputClasses: ['form-control'],
    formClasses: ['mb-3'],
    fun: async (value, original) => {
      return ApiC.patch(`${Model.Team}/current/${Model.TeamGroup}/${original.dataset.id}`, {'name': value})
        .then(resp => resp.json()).then(json => json.name);
    },
    listenOn: '.malleableTeamgroupName',
    returnedValueIsTrustedHtml: false,
    submit : i18next.t('save'),
    submitClasses: ['button', 'btn', 'btn-primary', 'mt-2'],
    tooltip: i18next.t('click-to-edit'),
  }).listen();

  // add an observer so new team groups will get an event handler
  new MutationObserver(() => {
    malleableGroupname.listen();
  }).observe(document.getElementById('team_groups_div'), {childList: true});

  // CATEGORY SELECT
  $(document).on('change', '.catstatSelect', function() {
    const url = new URL(window.location.href);
    const queryParams = new URLSearchParams(url.search);
    updateCatStat($(this).data('target'), {type: EntityType.ItemType, id: parseInt(queryParams.get('templateid'), 10)}, String($(this).val()));
  });

  document.getElementById('container').addEventListener('click', event => {
    const el = (event.target as HTMLElement);
    // RUN ACTION ON SELECTED (BATCH)
    if (el.matches('[data-action="run-action-selected"]')) {
      const btn = el as HTMLButtonElement;
      const selected = getSelected();
      if (!Object.values(selected).some(array => array.length > 0)) {
        notify.error('nothing-selected');
        return;
      }
      const oldHTML = mkSpin(btn);
      selected['action'] = btn.dataset.what;
      // we use a custom notif message, so disable the native one
      ApiC.notifOnSaved = false;
      ApiC.post('batch', selected).then(res => {
        const processed = res.headers.get('location').split('/').pop();
        notify.success('entries-processed', { num: processed });
      }).finally(() => {
        mkSpinStop(btn, oldHTML);
      });
    } else if (el.matches('[data-action="update-counter-value"]')) {
      const counterValue = el.parentElement.parentElement.parentElement.previousElementSibling.querySelector('.counterValue');
      const box = el as HTMLInputElement;
      let count = parseInt(counterValue.textContent, 10);
      if (box.checked) {
        count += 1;
      } else {
        count -= 1;
      }
      counterValue.textContent = String(count);
    // UPDATE ITEMS TYPES
    } else if (el.matches('[data-action="itemstypes-update"]')) {
      return ApiC.patch(`${EntityType.ItemType}/${el.dataset.id}`, {'body': getEditor().getContent()});
    // DESTROY ITEMS TYPES
    } else if (el.matches('[data-action="itemstypes-destroy"]')) {
      if (confirm(i18next.t('generic-delete-warning'))) {
        ApiC.delete(`${EntityType.ItemType}/${el.dataset.id}`).then(() => window.location.href = '?tab=4');
      }
    } else if (el.matches('[data-action="create-teamgroup"]')) {
      const input = (document.getElementById('teamGroupCreate') as HTMLInputElement);
      ApiC.post(`${Model.Team}/current/${Model.TeamGroup}`, {'name': input.value}).then(() => {
        reloadElements(['team_groups_div']);
        input.value = '';
      });
    // ADD USER TO TEAM GROUP
    } else if (el.matches('[data-action="adduser-teamgroup"]')) {
      const user = parseInt(el.parentNode.parentNode.querySelector('input').value, 10);
      if (isNaN(user)) {
        notify.error('add-user-error');
        return;
      }
      ApiC.patch(
        `${Model.Team}/current/${Model.TeamGroup}/${el.dataset.groupid}`,
        {'how': Action.Add, 'userid': user},
      ).then(() => reloadElements(['team_groups_div']));
    // RM USER FROM TEAM GROUP
    } else if (el.matches('[data-action="rmuser-teamgroup"]')) {
      ApiC.patch(`${Model.Team}/current/${Model.TeamGroup}/${el.dataset.groupid}`, {'how': Action.Unreference, 'userid': el.dataset.userid})
        .then(() => el.parentElement.remove());
    // DELETE TEAM GROUP
    } else if (el.matches('[data-action="destroy-teamgroup"]')) {
      if (confirm(i18next.t('generic-delete-warning'))) {
        ApiC.delete(`${Model.Team}/current/${Model.TeamGroup}/${el.dataset.id}`)
          .then(() => el.parentElement.remove());
      }
    // EXPORT CATEGORY
    } else if (el.matches('[data-action="export-category"]')) {
      const source = (document.getElementById('categoryExport') as HTMLSelectElement).value;
      const format = (document.getElementById('categoryExportFormat') as HTMLSelectElement).value;
      window.location.href = `make.php?format=${format}&category=${source}&type=items`;

    // ADD TAG
    } else if (el.matches('[data-action="admin-add-tag"]')) {
      const tagInput = (document.getElementById('adminAddTagInput') as HTMLInputElement);
      if (!tagInput.value) {
        return;
      }
      ApiC.post(`${Model.Team}/current/${Model.Tag}`, {'tag': tagInput.value}).then(() => {
        tagInput.value = '';
        reloadElements(['tagMgrDiv']);
      });
    } else if (el.matches('[data-action="patch-team-common-template"]')) {
      const params = {};
      params['common_template'] = tinymce.get('common_template').getContent();
      params['common_template_md'] = (document.getElementById('common_template_md') as HTMLTextAreaElement).value;
      ApiC.patch(`${Model.Team}/current`, params);
    } else if (el.matches('[data-action="patch-newcomer_banner"]')) {
      const params = {};
      params['newcomer_banner'] = tinymce.get('newcomer_banner').getContent();
      ApiC.patch(`${Model.Team}/current`, params);
    } else if (el.matches('[data-action="patch-team-common-template-md"]')) {
      const params = {};
      params['common_template_md'] = (document.getElementById('common_template_md') as HTMLTextAreaElement).value;
      ApiC.patch(`${Model.Team}/current`, params);
    } else if (el.matches('[data-action="export-scheduler"]')) {
      const from = (document.getElementById('schedulerDateFrom') as HTMLSelectElement).value;
      const to = (document.getElementById('schedulerDateTo') as HTMLSelectElement).value;
      window.location.href = `make.php?format=schedulerReport&start=${from}&end=${to}`;
    // PATCH ONBOARDING EMAIL
    } else if (el.matches('[data-action="patch-onboarding-email"]')) {
      const key = 'onboarding_email_body';
      ApiC.patch(`${Model.Team}/current`, {
        [key]: tinymce.get(key).getContent(),
      });
    } else if (el.matches('[data-action="open-onboarding-email-modal"]')) {
      // reload the modal in case the users of the team have changed
      reloadElements(['sendOnboardingEmailModal'])
        .then(() => $('#sendOnboardingEmailModal').modal('toggle'))
        .then(() => new TomSelect('#sendOnboardingEmailToUsers', {
          plugins: ['dropdown_input', 'no_active_items', 'remove_button'],
        }));
    } else if (el.matches('[data-action="send-onboarding-emails"]')) {
      ApiC.notifOnSaved = false;
      ApiC.patch(`${Model.Team}/current`, {
        'action': Action.SendOnboardingEmails,
        'userids': Array.from((document.getElementById('sendOnboardingEmailToUsers') as HTMLSelectElement).selectedOptions)
          .map(option => parseInt(option.value, 10)),
      }).then(response => {
        if (response.ok) {
          notify.success('onboarding-email-sent');
        }
      });
    }
  });
}
