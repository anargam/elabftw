<?php

/**
 * @author Nicolas CARPi <nico-git@deltablot.email>
 * @copyright 2023 Nicolas CARPi
 * @see https://www.elabftw.net Official website
 * @license AGPL-3.0
 * @package elabftw
 */

declare(strict_types=1);

namespace Elabftw\Commands;

use DateTimeImmutable;
use Elabftw\Elabftw\Db;
use Elabftw\Exceptions\ImproperActionException;
use Elabftw\Models\Experiments;
use Elabftw\Models\Users;
use Exception;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputArgument;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;
use Override;

/**
 * Timestamp experiments in bulk
 */
#[AsCommand(name: 'experiments:timestamp')]
final class ExperimentsTimestamp extends Command
{
    #[Override]
    protected function configure(): void
    {
        $this->setDescription('Timestamp experiments in bulk')
             ->setHelp('Look at experiments modified since a certain time and timestamp them with RFC3161 timestamping.')
             ->addArgument('user', InputArgument::REQUIRED, 'Userid of the user doing the timestamp action.')
             ->addOption('modified-since', 'm', InputOption::VALUE_REQUIRED, 'How long back in time we look for modified experiments to timestamp.', '1 week')
             ->addOption('dry-run', 'd', InputOption::VALUE_NONE, "Just count the number of experiments but don't actually timestamp them. Use with -vv.")
             ->addOption('teams', 't', InputOption::VALUE_REQUIRED | InputOption::VALUE_IS_ARRAY, 'Only timestamp experiments from these teams', array());
    }

    #[Override]
    protected function execute(InputInterface $input, OutputInterface $output)
    {
        $unixTimestamp = strtotime('-' . $input->getOption('modified-since'));
        if ($unixTimestamp === false) {
            throw new ImproperActionException('Wrong modified-since parameter.');
        }
        $dateTimeImmutable = DateTimeImmutable::createFromFormat('U', (string) $unixTimestamp);
        if ($dateTimeImmutable === false) {
            throw new ImproperActionException('Wrong modified-since parameter.');
        }
        if ($output->isVeryVerbose()) {
            $output->writeln(sprintf('Computed origin date: %s', $dateTimeImmutable->format('Y-m-d H:i:s')));
        }
        $Db = Db::getConnection();
        $sql = 'SELECT id FROM experiments WHERE modified_at > :m AND IFNULL(timestamped_at, NOW()) != modified_at';
        $teams = $input->getOption('teams');
        if ($teams) {
            $sql .= sprintf(' AND team IN (%s)', implode(',', $teams));
        }

        $req = $Db->prepare($sql);
        $req->bindValue(':m', $dateTimeImmutable->format('Y-m-d H:i:s'));
        $req->execute();
        $expArr = $req->fetchAll();
        if ($output->isVerbose()) {
            $output->writeln(sprintf('Found %d experiments to timestamp.', count($expArr)));
        }
        if ($input->getOption('dry-run')) {
            return 0;
        }
        $userid = (int) $input->getArgument('user');
        $Experiments = new Experiments(new Users($userid), bypassReadPermission: true, bypassWritePermission: true);
        foreach ($expArr as $exp) {
            if ($output->isVerbose()) {
                $output->writeln(sprintf('Timestamping experiment %d', $exp['id']));
            }
            $Experiments->setId($exp['id']);
            try {
                $Experiments->timestamp();
            } catch (Exception $e) {
                $output->writeln(sprintf('Error timestamping experiment with ID %d: %s', $exp['id'], $e->getMessage()));
            }

        }

        return 0;
    }
}
